"""
Bulk Email Harvester
Hard timeout is STRICTLY enforced — no site can ever block the queue.
"""

import json
import os
import queue
import re
import threading
import time
import urllib.parse
import uuid
from html import unescape
from typing import Optional

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template_string, request

app = Flask(__name__)

SKIP_LIST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "skip_domains.txt")


def load_skip_list() -> set:
    domains = set()
    if not os.path.exists(SKIP_LIST_FILE):
        return domains
    try:
        with open(SKIP_LIST_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    line = re.sub(r"^https?://", "", line).rstrip("/")
                    domains.add(line.lower())
    except Exception:
        pass
    return domains


def add_to_skip_list(url: str):
    try:
        netloc = urllib.parse.urlparse(url).netloc or url
        netloc = netloc.lower()
        if netloc in load_skip_list():
            return
        with open(SKIP_LIST_FILE, "a", encoding="utf-8") as f:
            f.write(f"{netloc}\n")
    except Exception:
        pass


def remove_from_skip_list(url: str):
    try:
        netloc = urllib.parse.urlparse(url).netloc or url
        netloc = netloc.lower()
        existing = load_skip_list()
        if netloc not in existing:
            return
        existing.discard(netloc)
        with open(SKIP_LIST_FILE, "w", encoding="utf-8") as f:
            for domain in sorted(existing):
                f.write(domain + "\n")
    except Exception:
        pass


def url_in_skip_list(url: str, skip_list: set) -> bool:
    try:
        return (urllib.parse.urlparse(url).netloc.lower() in skip_list)
    except Exception:
        return False


PLAYWRIGHT_AVAILABLE = False
try:
    from playwright.sync_api import sync_playwright

    PLAYWRIGHT_AVAILABLE = True
except Exception:
    pass


class BrowserThread(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="BrowserThread")
        self._job_queue = queue.Queue()
        self._stop_event = threading.Event()
        self._alive = False
        self._cur_page = None
        self._cur_context = None
        self._page_lock = threading.Lock()
        self.start()
        for _ in range(40):
            if self._alive:
                break
            time.sleep(0.1)

    def fetch(self, url: str, budget_secs: int, abort_event: threading.Event) -> Optional[str]:
        if not self._alive:
            return None
        result_box = [None]
        done_ev = threading.Event()
        self._job_queue.put((url, budget_secs, abort_event, result_box, done_ev))
        done_ev.wait(timeout=budget_secs + 5)
        return result_box[0]

    def kill_current_page(self):
        with self._page_lock:
            page = self._cur_page
            context = self._cur_context
        try:
            if page:
                page.close()
        except Exception:
            pass
        try:
            if context:
                context.close()
        except Exception:
            pass

    def stop(self):
        self._stop_event.set()
        self._job_queue.put(None)

    def run(self):
        if not PLAYWRIGHT_AVAILABLE:
            return
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=False, args=["--no-sandbox", "--disable-dev-shm-usage"])
                self._alive = True
                while not self._stop_event.is_set():
                    try:
                        job = self._job_queue.get(timeout=1)
                    except queue.Empty:
                        continue
                    if job is None:
                        break
                    url, budget, abort_ev, result_box, done_ev = job
                    result_box[0] = self._fetch(browser, url, budget, abort_ev)
                    done_ev.set()
                try:
                    browser.close()
                except Exception:
                    pass
                self._alive = False
        except Exception:
            self._alive = False

    def _safe_wait(self, page, ms: int, abort_event: threading.Event):
        for _ in range(max(1, ms // 200)):
            if abort_event.is_set():
                return
            try:
                page.wait_for_timeout(200)
            except Exception:
                return

    def _fetch(self, browser, url: str, budget_secs: int, abort_event: threading.Event) -> Optional[str]:
        context = None
        page = None
        try:
            if abort_event.is_set():
                return None
            context = browser.new_context(ignore_https_errors=True)
            page = context.new_page()
            with self._page_lock:
                self._cur_page = page
                self._cur_context = context
            page.goto(url, timeout=min(20000, budget_secs * 1000), wait_until="domcontentloaded")
            self._safe_wait(page, 1200, abort_event)
            if abort_event.is_set():
                return None
            try:
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                self._safe_wait(page, 600, abort_event)
            except Exception:
                pass
            return page.content() if not abort_event.is_set() else None
        except Exception:
            return None
        finally:
            with self._page_lock:
                self._cur_page = None
                self._cur_context = None
            try:
                if page:
                    page.close()
            except Exception:
                pass
            try:
                if context:
                    context.close()
            except Exception:
                pass


_browser_thread: Optional[BrowserThread] = None
_bt_lock = threading.Lock()


def get_browser_thread() -> Optional[BrowserThread]:
    global _browser_thread
    if not PLAYWRIGHT_AVAILABLE:
        return None
    with _bt_lock:
        if _browser_thread is None or not _browser_thread.is_alive():
            _browser_thread = BrowserThread()
        return _browser_thread


def stop_browser_thread():
    global _browser_thread
    with _bt_lock:
        bt = _browser_thread
        _browser_thread = None
    if bt:
        bt.stop()


EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", re.IGNORECASE)
MAILTO_RE = re.compile(r"mailto:[\"']?\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})", re.IGNORECASE)

REJECT_TLDS = {
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff", "pdf", "css", "js", "jsx",
    "ts", "tsx", "json", "xml", "zip", "gz", "woff", "woff2", "ttf", "eot", "otf", "map",
    "mp4", "mp3", "wav", "cat", "pbz", "bet", "arg", "rqh",
}
REJECT_LOCALS_EXACT = {
    "noreply", "no-reply", "donotreply", "do-not-reply", "unsubscribe", "bounce", "mailer-daemon",
    "postmaster", "abuse", "spam", "webmaster", "root", "www",
}
REJECT_DOMAINS = {
    "example.com", "test.com", "localhost", "domain.com", "yourdomain.com", "email.com", "website.com",
    "yoursite.com", "sentry.io", "sentry-next.wixpress.com", "2x.cat",
}
IMAGE_FILENAME_RE = re.compile(r"(logo|icon|image|img|banner|bg|background|sprite|thumb|photo|avatar|favicon|placeholder|hero|cover|tile|asset|graphic).*@\d", re.I)
CONTACT_PATTERNS = re.compile(r"/(contact|about|support|help|team|staff|reach|connect|get-in-touch|press|media)", re.I)


def decode_at_dot(text: str) -> str:
    text = re.sub(r"\s*\[at\]\s*", "@", text, flags=re.I)
    text = re.sub(r"\s*\(at\)\s*", "@", text, flags=re.I)
    text = re.sub(r"\s*\[dot\]\s*", ".", text, flags=re.I)
    text = re.sub(r"\s*\(dot\)\s*", ".", text, flags=re.I)
    text = re.sub(r"(?<=\w)\s+at\s+(?=\w)", "@", text, flags=re.I)
    text = re.sub(r"(?<=\w)\s+dot\s+(?=\w)", ".", text, flags=re.I)
    return text


def normalize_email(raw: str) -> Optional[str]:
    if not raw:
        return None
    email = raw.strip().strip('"\'<>(),;:[]{}').lower()
    if not email or "@" not in email:
        return None
    parts = email.split("@")
    if len(parts) != 2:
        return None
    local, domain = parts
    if local in REJECT_LOCALS_EXACT or domain in REJECT_DOMAINS:
        return None
    if "." not in domain:
        return None
    if domain.rsplit(".", 1)[-1] in REJECT_TLDS:
        return None
    if IMAGE_FILENAME_RE.search(email):
        return None
    if not EMAIL_RE.fullmatch(email):
        return None
    return email


def extract_from_html(html: str, source: str) -> list:
    results = []
    for m in MAILTO_RE.findall(html):
        n = normalize_email(m)
        if n:
            results.append({"email": n, "confidence": "high", "source": "mailto"})
    for m in EMAIL_RE.findall(html):
        n = normalize_email(m)
        if n:
            results.append({"email": n, "confidence": "medium", "source": source})
    decoded = decode_at_dot(unescape(html))
    for m in EMAIL_RE.findall(decoded):
        n = normalize_email(m)
        if n:
            results.append({"email": n, "confidence": "low", "source": "obfuscation"})
    return results


def extract_from_soup(soup: BeautifulSoup) -> list:
    results = []
    for a in soup.find_all("a", href=True):
        href = a.get("href", "")
        if href.lower().startswith("mailto:"):
            n = normalize_email(href.split(":", 1)[1].split("?")[0])
            if n:
                results.append({"email": n, "confidence": "high", "source": "mailto-dom"})
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            blob = json.dumps(json.loads(script.string or ""))
        except Exception:
            blob = script.get_text(" ", strip=True)
        for m in EMAIL_RE.findall(blob):
            n = normalize_email(m)
            if n:
                results.append({"email": n, "confidence": "high", "source": "jsonld"})
    for meta in soup.find_all("meta", content=True):
        for m in EMAIL_RE.findall(meta.get("content", "")):
            n = normalize_email(m)
            if n:
                results.append({"email": n, "confidence": "medium", "source": "meta"})
    for el in soup.find_all(itemprop="email"):
        for m in EMAIL_RE.findall(el.get_text(" ", strip=True) + " " + (el.get("content") or "")):
            n = normalize_email(m)
            if n:
                results.append({"email": n, "confidence": "high", "source": "microdata"})
    for el in soup.find_all(True):
        for attr in ["data-email", "data-contact", "data-mail", "data-mailto"]:
            for m in EMAIL_RE.findall(el.get(attr, "")):
                n = normalize_email(m)
                if n:
                    results.append({"email": n, "confidence": "medium", "source": "data-attr"})
    body = decode_at_dot(unescape(soup.get_text(separator=" ")))
    for m in EMAIL_RE.findall(body):
        n = normalize_email(m)
        if n:
            results.append({"email": n, "confidence": "medium", "source": "body"})
    return results


def dedupe_results(results: list, cap: int = 50) -> list:
    order = {"high": 0, "medium": 1, "low": 2}
    seen = {}
    for r in results:
        e = r["email"]
        if e not in seen or order[r["confidence"]] < order[seen[e]["confidence"]]:
            seen[e] = r
    return sorted(seen.values(), key=lambda x: (order[x["confidence"]], x["email"]))[:cap]


def discover_secondary_urls(html: str, base_url: str, visited: set, limit: int) -> list:
    found = []
    soup = BeautifulSoup(html, "html.parser")
    base_netloc = urllib.parse.urlparse(base_url).netloc
    for a in soup.find_all("a", href=True):
        if len(found) >= limit:
            break
        href = a.get("href", "").strip()
        if not href or href.startswith("#") or href.startswith("javascript:"):
            continue
        if not CONTACT_PATTERNS.search(href):
            continue
        full = urllib.parse.urljoin(base_url, href)
        p = urllib.parse.urlparse(full)
        if p.netloc != base_netloc:
            continue
        clean = urllib.parse.urlunparse((p.scheme, p.netloc, p.path, "", "", ""))
        if clean not in visited and clean != base_url:
            visited.add(clean)
            found.append(clean)
    return found


def apply_exclusion_rules(emails: list[str], rules: list[str]) -> list[str]:
    kept = []
    for email in emails:
        excluded = False
        for rule in rules:
            r = rule.strip().lower()
            if not r or r.startswith("#"):
                continue
            if r.startswith("@"):
                d = r[1:]
                emd = email.split("@")[1]
                if emd == d or emd.endswith("." + d):
                    excluded = True
                    break
            elif "@" in r:
                if email == r:
                    excluded = True
                    break
            else:
                if r in email.split("@")[0]:
                    excluded = True
                    break
        if not excluded:
            kept.append(email)
    return kept


def fetch_url_requests(url: str, timeout: int = 12) -> Optional[str]:
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    variants = [url]
    if url.startswith("https://"):
        variants.append("http://" + url[8:])
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc and not parsed.netloc.startswith("www."):
        variants.append(f"{parsed.scheme}://www.{parsed.netloc}")
    best = None
    for u in variants:
        try:
            r = requests.get(u, headers=headers, timeout=max(4, timeout), allow_redirects=True)
            r.raise_for_status()
            text = r.text or ""
            if text and len(text) > len(best or ""):
                best = text
                if len(text) > 4000:
                    break
        except Exception:
            continue
    return best


def normalize_url(raw: str) -> Optional[str]:
    raw = (raw or "").strip()
    if not raw:
        return None
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    p = urllib.parse.urlparse(raw)
    return f"{p.scheme}://{p.netloc}" if p.netloc else None


def scrape_domain(url: str, exclusion_rules: list, hard_timeout: int, abort_event: threading.Event, max_pages: int) -> dict:
    start = time.time()
    all_results = []
    visited = {url}

    def left() -> int:
        return max(1, int(hard_timeout - (time.time() - start)))

    try:
        raw_html = None
        if not abort_event.is_set():
            raw_html = fetch_url_requests(url, timeout=min(12, left()))
            if raw_html:
                all_results.extend(extract_from_html(raw_html, "source"))
                all_results.extend(extract_from_soup(BeautifulSoup(raw_html, "html.parser")))

        pw_html = None
        if not abort_event.is_set() and left() > 5:
            bt = get_browser_thread()
            if bt:
                pw_html = bt.fetch(url, max(5, left() - 2), abort_event)
                if pw_html and not abort_event.is_set():
                    all_results.extend(extract_from_html(pw_html, "browser"))
                    all_results.extend(extract_from_soup(BeautifulSoup(pw_html, "html.parser")))

        seed = pw_html or raw_html
        if seed and not abort_event.is_set() and left() > 4:
            secondary = discover_secondary_urls(seed, url, visited, limit=max_pages)
            for sec in secondary:
                if abort_event.is_set() or left() < 2:
                    break
                sec_html = fetch_url_requests(sec, timeout=min(8, left()))
                if sec_html:
                    all_results.extend(extract_from_html(sec_html, "secondary"))
                    all_results.extend(extract_from_soup(BeautifulSoup(sec_html, "html.parser")))

        if not all_results and not raw_html and not pw_html:
            return {"url": url, "emails": [], "status": "no_content", "error": "Could not fetch"}

        deduped = dedupe_results(all_results, cap=50)
        filtered = apply_exclusion_rules([r["email"] for r in deduped], exclusion_rules)
        final = [r for r in deduped if r["email"] in set(filtered)]
        status = "skipped_timeout" if abort_event.is_set() else ("success" if final else "no_emails")
        return {"url": url, "emails": final, "status": status, "error": ""}
    except Exception as e:
        return {"url": url, "emails": [], "status": "skipped_error", "error": str(e)}


class RunState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.run_id = None
        self.urls = []
        self.results = {}
        self.next_index = 0
        self.status = "idle"
        self.stop_requested = False
        self.force_stop = False
        self.skip_requested = False
        self.exclusion_rules = []
        self.hard_timeout = 45
        self.max_pages = 5
        self.current_domain = ""
        self.current_index = 0
        self.total = 0
        self.lock = threading.Lock()
        self.abort_event = threading.Event()


RUN = RunState()


def run_worker(run_id: str):
    while True:
        with RUN.lock:
            if RUN.run_id != run_id:
                break
            if RUN.force_stop or RUN.stop_requested:
                RUN.status = "paused"
                break
            if RUN.next_index >= len(RUN.urls):
                RUN.status = "done"
                break
            idx = RUN.next_index
            url = RUN.urls[idx]
            RUN.current_index = idx
            RUN.current_domain = url
            RUN.next_index += 1
            hard_timeout = RUN.hard_timeout
            excl_rules = RUN.exclusion_rules
            max_pages = RUN.max_pages
            abort_ev = threading.Event()
            RUN.abort_event = abort_ev

        if url_in_skip_list(url, load_skip_list()):
            with RUN.lock:
                RUN.results[url] = {"url": url, "emails": [], "status": "skip-listed", "error": "Domain in skip list"}
            continue

        add_to_skip_list(url)
        result_holder = [None]
        scrape_done = threading.Event()

        def do_scrape():
            result_holder[0] = scrape_domain(url, excl_rules, hard_timeout, abort_ev, max_pages)
            scrape_done.set()

        t = threading.Thread(target=do_scrape, daemon=True)

        def on_timeout():
            abort_ev.set()
            bt = get_browser_thread()
            if bt:
                bt.kill_current_page()

        timer = threading.Timer(hard_timeout, on_timeout)
        timer.start()
        t.start()

        while not scrape_done.is_set():
            time.sleep(0.3)
            with RUN.lock:
                force = RUN.force_stop
                skip = RUN.skip_requested
            if force or skip:
                abort_ev.set()
                bt = get_browser_thread()
                if bt:
                    bt.kill_current_page()
                with RUN.lock:
                    RUN.skip_requested = False
                scrape_done.wait(timeout=3)
                break

        timer.cancel()

        result = result_holder[0] or {
            "url": url,
            "emails": [],
            "status": "skipped_timeout",
            "error": f"Hard timeout after {hard_timeout}s",
        }

        if result.get("status") != "skipped_timeout":
            remove_from_skip_list(url)

        with RUN.lock:
            RUN.results[url] = result
            if RUN.force_stop or RUN.stop_requested:
                RUN.status = "paused"
                break

    stop_browser_thread()


@app.route("/")
def index():
    return render_template_string(open("index.html", "r", encoding="utf-8").read())


@app.route("/api/start", methods=["POST"])
def api_start():
    data = request.get_json(force=True)
    raw_urls = data.get("urls", [])
    excl_text = data.get("exclusion_rules", "")
    hard_timeout = int(data.get("hard_timeout", 45))
    max_pages = int(data.get("max_pages", 5))

    urls, seen = [], set()
    for raw in raw_urls:
        n = normalize_url(raw)
        if n and n not in seen:
            urls.append(n)
            seen.add(n)

    if not urls:
        return jsonify({"ok": False, "error": "No valid URLs provided"})

    excl_rules = [r.strip() for r in excl_text.splitlines() if r.strip() and not r.strip().startswith("#")]

    if PLAYWRIGHT_AVAILABLE:
        threading.Thread(target=get_browser_thread, daemon=True).start()

    with RUN.lock:
        RUN.reset()
        RUN.run_id = str(uuid.uuid4())
        RUN.urls = urls
        RUN.total = len(urls)
        RUN.status = "running"
        RUN.exclusion_rules = excl_rules
        RUN.hard_timeout = hard_timeout
        RUN.max_pages = max(1, max_pages)
        run_id = RUN.run_id

    threading.Thread(target=run_worker, args=(run_id,), daemon=True).start()
    return jsonify({"ok": True, "run_id": run_id, "total": len(urls), "playwright": PLAYWRIGHT_AVAILABLE})


@app.route("/api/status")
def api_status():
    with RUN.lock:
        return jsonify({
            "ok": True,
            "status": RUN.status,
            "current_index": RUN.current_index,
            "total": RUN.total,
            "current_domain": RUN.current_domain,
            "results": [RUN.results[u] for u in RUN.urls if u in RUN.results],
            "playwright": PLAYWRIGHT_AVAILABLE,
        })


@app.route("/api/continue", methods=["POST"])
def api_continue():
    with RUN.lock:
        if RUN.status not in ("paused", "idle"):
            return jsonify({"ok": False, "error": "Run is not paused"})
        if not RUN.urls:
            return jsonify({"ok": False, "error": "No run to continue"})
        RUN.stop_requested = False
        RUN.force_stop = False
        RUN.status = "running"
        run_id = RUN.run_id

    threading.Thread(target=run_worker, args=(run_id,), daemon=True).start()
    return jsonify({"ok": True})


@app.route("/api/stop", methods=["POST"])
def api_stop():
    with RUN.lock:
        RUN.stop_requested = True
        RUN.abort_event.set()
    bt = get_browser_thread()
    if bt:
        bt.kill_current_page()
    return jsonify({"ok": True})


@app.route("/api/force_stop", methods=["POST"])
def api_force_stop():
    with RUN.lock:
        RUN.force_stop = True
        RUN.stop_requested = True
        RUN.abort_event.set()
    bt = get_browser_thread()
    if bt:
        bt.kill_current_page()
    return jsonify({"ok": True})


@app.route("/api/skip", methods=["POST"])
def api_skip():
    with RUN.lock:
        RUN.skip_requested = True
        RUN.abort_event.set()
    bt = get_browser_thread()
    if bt:
        bt.kill_current_page()
    return jsonify({"ok": True})


@app.route("/api/reset", methods=["POST"])
def api_reset():
    with RUN.lock:
        RUN.abort_event.set()
        RUN.reset()
    stop_browser_thread()
    return jsonify({"ok": True})


@app.route("/api/skiplist", methods=["GET"])
def api_skiplist_get():
    return jsonify({"ok": True, "domains": sorted(load_skip_list()), "file": SKIP_LIST_FILE})


if __name__ == "__main__":
    print("=" * 64)
    print("Bulk Email Harvester")
    print("Open: http://127.0.0.1:5000")
    print("=" * 64)
    app.run(debug=False, port=5000, threaded=True)
