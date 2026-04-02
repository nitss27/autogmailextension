import base64
import json
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Dict, List, Optional, Set
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
STATE_PATH = Path("run_state.json")
EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")
SECONDARY_RE = re.compile(r"contact|about|support|help|team|staff|reach-us", re.I)
BAD_TLDS = {"png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "pdf", "css", "js", "json", "xml", "zip"}
PLACEHOLDERS = ("example@", "test@", "user@", "email@", "noreply@", "no-reply@", "donotreply@")

run_lock = threading.Lock()
worker_thread: Optional[threading.Thread] = None


def default_state():
    return {
        "status": "idle",
        "requestId": "",
        "urls": [],
        "nextIndex": 0,
        "current": 0,
        "total": 0,
        "domain": "",
        "results": [],
        "excludeEmails": [],
        "tabLoadTimeoutMs": 12000,
        "forceSkipAfterMs": None,
        "hardUrlTimeoutMs": 15000,
        "stopRequested": False,
        "forceStopRequested": False,
        "skipRequested": False,
        "summary": ""
    }


def load_state():
    if not STATE_PATH.exists():
        return default_state()
    try:
        return {**default_state(), **json.loads(STATE_PATH.read_text())}
    except Exception:
        return default_state()


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2))


state = load_state()


@dataclass
class EmailHit:
    email: str
    source: str


def normalize_url(line: str) -> Optional[str]:
    line = (line or "").strip()
    if not line:
        return None
    if not re.match(r"^https?://", line, re.I):
        line = f"https://{line}"
    try:
        parsed = urlparse(line)
        if not parsed.netloc:
            return None
        return f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return None


def normalize_urls(lines: List[str]) -> List[str]:
    out, seen = [], set()
    for raw in lines:
        n = normalize_url(raw)
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def parse_rules(raw: str) -> List[str]:
    rules = []
    seen = set()
    for line in raw.splitlines():
        rule = line.strip().lower()
        if not rule or rule.startswith("#"):
            continue
        if rule not in seen:
            seen.add(rule)
            rules.append(rule)
    return rules


def extract_from_text(text: str) -> List[str]:
    return [m.group(0).lower() for m in EMAIL_REGEX.finditer(text or "")]


def decode_obfuscations(text: str) -> List[str]:
    s = unescape(text or "")
    normalized = (
        s.replace("[at]", "@").replace("[dot]", ".")
        .replace(" AT ", "@").replace(" DOT ", ".")
        .replace(" at ", "@").replace(" dot ", ".")
        .replace("＠", "@").replace("﹫", "@").replace("。", ".")
    )
    out = extract_from_text(normalized)

    for token in re.findall(r"\b[^\s]{6,}\b", s):
        rev = token[::-1]
        if "@" in rev:
            out.extend(extract_from_text(rev))

    def rot13(inp: str):
        result = []
        for c in inp:
            if "a" <= c <= "z":
                result.append(chr((ord(c) - 97 + 13) % 26 + 97))
            elif "A" <= c <= "Z":
                result.append(chr((ord(c) - 65 + 13) % 26 + 65))
            else:
                result.append(c)
        return "".join(result)

    out.extend(extract_from_text(rot13(s)))

    for token in re.findall(r"[A-Za-z0-9+/=]{12,}", s):
        try:
            dec = base64.b64decode(token).decode("utf-8", errors="ignore")
            if "@" in dec:
                out.extend(extract_from_text(dec))
        except Exception:
            pass

    return list(dict.fromkeys(out))


def confidence_for(sources: Set[str]) -> str:
    if "mailto" in sources or "jsonld" in sources:
        return "high"
    if ("html" in sources and "raw" in sources) or "text" in sources or "meta" in sources:
        return "medium"
    return "low"


def clean_email(email: str) -> str:
    return re.sub(r"""^["'`(\[{<\s]+|["'`)\]}>.,;:!?\s]+$""", "", (email or "").strip().lower())


def apply_filters(hits: List[EmailHit], rules: List[str]) -> List[Dict[str, str]]:
    exact, domains, tlds, keywords = set(), [], set(), []
    for r in rules:
        if r.startswith("@."):
            tlds.add(r[2:])
        elif r.startswith("@"):
            domains.append(r[1:])
        elif "@" in r:
            exact.add(r)
        else:
            keywords.append(r)

    bag: Dict[str, Set[str]] = {}
    for hit in hits:
        e = clean_email(hit.email)
        if not EMAIL_REGEX.fullmatch(e):
            continue
        if len(e) > 254 or e in exact or any(e.startswith(p) for p in PLACEHOLDERS):
            continue
        local, dom = e.split("@", 1)
        tld = dom.split(".")[-1]
        if not local or not dom or ".." in local or "/" in e or "\\" in e:
            continue
        if tld in BAD_TLDS or tld in tlds or dom.endswith("@localhost"):
            continue
        if dom in {"example.com", "test.com", "localhost"}:
            continue
        if any(dom == d or dom.endswith(f".{d}") for d in domains):
            continue
        if any(k in local for k in keywords):
            continue
        bag.setdefault(e, set()).add(hit.source)

    result = [{"email": e, "confidence": confidence_for(src)} for e, src in bag.items()]
    return result[:20]


def discover_secondary(base_url: str, soup: BeautifulSoup) -> List[str]:
    out, seen = [], set()
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        full = urljoin(base_url, href)
        if full in seen:
            continue
        seen.add(full)
        if SECONDARY_RE.search(full):
            out.append(full)
        if len(out) >= 3:
            break
    return out


def fetch_url(url: str, timeout_sec=10) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    r = requests.get(url, timeout=timeout_sec, headers=headers, allow_redirects=True)
    return r.text


def scrape_html(url: str, html: str, out_hits: List[EmailHit]):
    soup = BeautifulSoup(html, "html.parser")

    for e in extract_from_text(html):
        out_hits.append(EmailHit(e, "html"))
    for e in extract_from_text(soup.get_text(" ", strip=True)):
        out_hits.append(EmailHit(e, "text"))
    for a in soup.select('a[href^="mailto:"]'):
        mail = (a.get("href", "").replace("mailto:", "", 1).split("?")[0]).lower()
        if mail:
            out_hits.append(EmailHit(mail, "mailto"))
    for s in soup.select('script[type="application/ld+json"]'):
        for e in extract_from_text(s.get_text("", strip=True)):
            out_hits.append(EmailHit(e, "jsonld"))
    for m in soup.select("meta[content]"):
        for e in extract_from_text(m.get("content", "")):
            out_hits.append(EmailHit(e, "meta"))
    for n in soup.select('[itemprop="email"]'):
        for e in extract_from_text(n.get_text(" ", strip=True) + " " + (n.get("content", "") or "")):
            out_hits.append(EmailHit(e, "microdata"))
    for n in soup.select("*"):
        for k in ("data-email", "data-contact", "data-mail"):
            if n.get(k):
                for e in extract_from_text(n.get(k, "")):
                    out_hits.append(EmailHit(e, "dataAttr"))
    for e in decode_obfuscations(html):
        out_hits.append(EmailHit(e, "obfuscated"))
    return soup


def process_single_url(url: str, cfg: dict) -> dict:
    started = time.time()
    hard_timeout = max(10, int((cfg.get("hardUrlTimeoutMs") or 15000) / 1000))

    def work():
        hits: List[EmailHit] = []
        html = fetch_url(url, timeout_sec=10)
        soup = scrape_html(url, html, hits)

        for sec_url in discover_secondary(url, soup):
            if state.get("skipRequested") or state.get("forceStopRequested"):
                break
            try:
                sec_html = fetch_url(sec_url, timeout_sec=8)
                scrape_html(sec_url, sec_html, hits)
            except Exception:
                pass

        # raw source strategy
        for e in extract_from_text(html):
            hits.append(EmailHit(e, "raw"))

        cleaned = apply_filters(hits, cfg.get("excludeEmails", []))
        page_txt = soup.get_text(" ", strip=True).lower() if soup else ""
        status = "success" if cleaned else "no_content"
        err = ""
        if not cleaned and "verify you are human" in page_txt:
            err = "[CAPTCHA] verify you are human"
        return {
            "domain": urlparse(url).netloc,
            "url": url,
            "emails": cleaned,
            "error": err,
            "status": status,
            "durationMs": int((time.time() - started) * 1000),
        }

    with ThreadPoolExecutor(max_workers=1) as executor:
        fut = executor.submit(work)
        try:
            return fut.result(timeout=hard_timeout)
        except FuturesTimeoutError:
            return {
                "domain": urlparse(url).netloc,
                "url": url,
                "emails": [],
                "error": f"Hard timeout after {hard_timeout}s",
                "status": "skipped_timeout",
                "durationMs": int((time.time() - started) * 1000),
            }
        except Exception as ex:
            return {
                "domain": urlparse(url).netloc,
                "url": url,
                "emails": [],
                "error": str(ex),
                "status": "skipped_error",
                "durationMs": int((time.time() - started) * 1000),
            }


def run_worker():
    global worker_thread
    with run_lock:
        state["status"] = "running"
        state["stopRequested"] = False
        state["forceStopRequested"] = False
        state["skipRequested"] = False
        save_state(state)

    idx = state.get("nextIndex", 0)
    while idx < len(state["urls"]):
        with run_lock:
            if state.get("forceStopRequested"):
                state["status"] = "paused"
                save_state(state)
                break
            if state.get("stopRequested"):
                state["status"] = "paused"
                save_state(state)
                break

            state["current"] = idx + 1
            state["domain"] = urlparse(state["urls"][idx]).netloc
            save_state(state)

        if state.get("skipRequested"):
            result = {
                "domain": urlparse(state["urls"][idx]).netloc,
                "url": state["urls"][idx],
                "emails": [],
                "error": "Manually skipped",
                "status": "skipped_error",
            }
            with run_lock:
                state["skipRequested"] = False
        else:
            result = process_single_url(state["urls"][idx], state)
            if result["status"] in {"skipped_error", "no_content"}:
                # one retry with longer timeout
                retry_cfg = dict(state)
                retry_cfg["hardUrlTimeoutMs"] = int((state.get("hardUrlTimeoutMs") or 15000) * 1.5)
                retry = process_single_url(state["urls"][idx], retry_cfg)
                if retry["status"] == "success":
                    result = retry

        with run_lock:
            if len(state["results"]) <= idx:
                state["results"].extend([None] * (idx + 1 - len(state["results"])))
            state["results"][idx] = result
            state["nextIndex"] = idx + 1
            save_state(state)

        idx += 1
        time.sleep(0)

    with run_lock:
        if state["nextIndex"] >= len(state["urls"]):
            state["status"] = "done"
        results = [r for r in state["results"] if r]
        emails = {e["email"] for r in results for e in r.get("emails", [])}
        domains = {r.get("domain") for r in results}
        state["summary"] = f"Done. {len(results)} sites processed. {len(emails)} emails found across {len(domains)} domains."
        save_state(state)
        worker_thread = None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state")
def api_state():
    with run_lock:
        return jsonify(state)


@app.post("/api/start")
def api_start():
    global worker_thread
    body = request.get_json(force=True)
    urls = normalize_urls(body.get("urls", []))
    if not urls:
        return jsonify({"ok": False, "error": "No valid URLs"}), 400

    with run_lock:
        if state.get("status") == "running":
            return jsonify({"ok": False, "error": "Run already in progress"}), 400
        state.update(default_state())
        state.update({
            "status": "running",
            "requestId": str(uuid.uuid4()),
            "urls": urls,
            "total": len(urls),
            "excludeEmails": parse_rules(body.get("excludeRaw", "")),
            "tabLoadTimeoutMs": int(body.get("tabLoadTimeoutMs") or 12000),
            "forceSkipAfterMs": int(body.get("forceSkipAfterMs") or 0) or None,
            "hardUrlTimeoutMs": int(body.get("hardUrlTimeoutMs") or 15000),
        })
        save_state(state)

    worker_thread = threading.Thread(target=run_worker, daemon=True)
    worker_thread.start()
    return jsonify({"ok": True, "requestId": state["requestId"]})


@app.post("/api/continue")
def api_continue():
    global worker_thread
    with run_lock:
        if state.get("status") == "running":
            return jsonify({"ok": False, "error": "Already running"}), 400
        if not state.get("urls"):
            return jsonify({"ok": False, "error": "No previous run"}), 400
        state["status"] = "running"
        state["stopRequested"] = False
        state["forceStopRequested"] = False
        save_state(state)

    worker_thread = threading.Thread(target=run_worker, daemon=True)
    worker_thread.start()
    return jsonify({"ok": True})


@app.post("/api/stop")
def api_stop():
    with run_lock:
        state["stopRequested"] = True
        save_state(state)
    return jsonify({"ok": True})


@app.post("/api/force-stop")
def api_force_stop():
    with run_lock:
        state["forceStopRequested"] = True
        state["skipRequested"] = True
        save_state(state)
    return jsonify({"ok": True})


@app.post("/api/skip")
def api_skip():
    with run_lock:
        state["skipRequested"] = True
        save_state(state)
    return jsonify({"ok": True})


@app.post("/api/reset")
def api_reset():
    with run_lock:
        state.update(default_state())
        save_state(state)
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
