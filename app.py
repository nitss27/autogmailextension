"""
Bulk Email Harvester
Hard timeout is STRICTLY enforced — no site can ever block the queue.
Architecture:
  - run_worker owns a threading.Timer that fires at exactly hard_timeout seconds
  - When the timer fires (or skip/stop is pressed), it:
      1. Sets a global abort Event that scrape_domain checks
      2. Force-closes the current browser page immediately
      3. The do_scrape thread sees closed page / abort event and exits fast
  - This means the hard_timeout is a REAL ceiling, not a suggestion
"""

import os
import re
import time
import threading
import queue
import uuid
import json
import urllib.parse
from typing import Optional
import requests
from bs4 import BeautifulSoup
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Playwright

# ─────────────────────────────────────────────────────────────────────────────
# Skip-domain list  (skip_domains.txt)
#
# Any domain that times out is automatically written to skip_domains.txt.
# On the next run, those domains are skipped instantly with [skipped-listed].
# You can also manually add domains to this file (one per line, # = comment).
# Delete the file or clear it to reset the skip list.
# ─────────────────────────────────────────────────────────────────────────────

SKIP_LIST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'skip_domains.txt')


def load_skip_list() -> set:
    """Load domains from skip_domains.txt. Returns a set of bare hostnames."""
    domains = set()
    if not os.path.exists(SKIP_LIST_FILE):
        return domains
    try:
        with open(SKIP_LIST_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    # Strip protocol if user accidentally added it
                    line = re.sub(r'^https?://', '', line).rstrip('/')
                    domains.add(line.lower())
    except Exception:
        pass
    return domains


def add_to_skip_list(url: str):
    """Append a domain to skip_domains.txt. No-op if already present."""
    try:
        netloc = urllib.parse.urlparse(url).netloc or url
        netloc = netloc.lower()
        existing = load_skip_list()
        if netloc in existing:
            return
        with open(SKIP_LIST_FILE, 'a', encoding='utf-8') as f:
            f.write(f'{netloc}\n')
        print(f"[SkipList] + {netloc}")
    except Exception as e:
        print(f"[SkipList] write error: {e}")


def remove_from_skip_list(url: str):
    """Remove a domain from skip_domains.txt (called on successful scrape)."""
    try:
        netloc = urllib.parse.urlparse(url).netloc or url
        netloc = netloc.lower()
        existing = load_skip_list()
        if netloc not in existing:
            return
        existing.discard(netloc)
        # Rewrite file preserving comments
        lines_to_keep = []
        if os.path.exists(SKIP_LIST_FILE):
            with open(SKIP_LIST_FILE, 'r', encoding='utf-8') as f:
                for line in f:
                    stripped = line.strip()
                    if stripped.startswith('#') or stripped == '':
                        lines_to_keep.append(line)
                    elif stripped.lower() != netloc:
                        lines_to_keep.append(line)
        with open(SKIP_LIST_FILE, 'w', encoding='utf-8') as f:
            f.writelines(lines_to_keep)
        print(f"[SkipList] - {netloc} (completed OK)")
    except Exception as e:
        print(f"[SkipList] remove error: {e}")


def url_in_skip_list(url: str, skip_list: set) -> bool:
    """Return True if this URL's domain is in the skip list."""
    if not skip_list:
        return False
    try:
        from urllib.parse import urlparse
        netloc = urlparse(url).netloc.lower()
        return netloc in skip_list
    except Exception:
        return False


PLAYWRIGHT_AVAILABLE = False
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    pass


# ─────────────────────────────────────────────────────────────────────────────
# BrowserThread — owns Playwright, processes one page at a time
#
# Critical design:
#   - _fetch() runs in the browser thread itself (not a sub-thread)
#   - All page.goto / wait_for_timeout calls use short internal timeouts
#   - An external abort_event can be set at any time to unblock page calls
#   - When abort fires, we close the page → Playwright raises immediately
#   - The browser thread is NEVER stuck for more than ~2s after abort
# ─────────────────────────────────────────────────────────────────────────────

class BrowserThread(threading.Thread):

    def __init__(self):
        super().__init__(daemon=True, name="BrowserThread")
        self._job_queue   = queue.Queue()
        self._stop_event  = threading.Event()
        self._alive       = False
        self._cur_page    = None
        self._cur_context = None
        self._page_lock   = threading.Lock()
        self.start()
        # Give browser time to launch
        for _ in range(40):
            if self._alive:
                break
            time.sleep(0.1)

    # ── Public API ────────────────────────────────────────────────────────────

    def fetch(self, url: str, budget_secs: int,
              abort_event: threading.Event) -> Optional[str]:
        """
        Fetch url using the visible browser.
        budget_secs: max seconds to spend on this fetch
        abort_event: set this externally to force-stop immediately
        Returns rendered HTML or None.
        """
        if not self._alive:
            return None

        result_box = [None]
        done_ev    = threading.Event()

        job = (url, budget_secs, abort_event, result_box, done_ev)
        self._job_queue.put(job)

        # Wait for result — abort_event fires → browser closes page → done_ev fires
        done_ev.wait(timeout=budget_secs + 8)
        return result_box[0]

    def kill_current_page(self):
        """Force-close whatever page is currently open."""
        with self._page_lock:
            page    = self._cur_page
            context = self._cur_context
        try:
            if page:    page.close()
        except Exception:
            pass
        try:
            if context: context.close()
        except Exception:
            pass

    def stop(self):
        self._stop_event.set()
        self._job_queue.put(None)

    # ── Internal ──────────────────────────────────────────────────────────────

    def run(self):
        if not PLAYWRIGHT_AVAILABLE:
            return
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(
                    headless=False,
                    slow_mo=0,
                    args=[
                        '--disable-blink-features=AutomationControlled',
                        '--no-sandbox',
                        '--disable-dev-shm-usage',
                        '--start-maximized',
                    ],
                )
                self._alive = True
                print("[Browser] Chromium launched (visible)")

                while not self._stop_event.is_set():
                    try:
                        job = self._job_queue.get(timeout=1.0)
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
                print("[Browser] Chromium closed")

        except Exception as e:
            print(f"[Browser] Fatal: {e}")
            self._alive = False

    def _safe_wait(self, page, ms: int, abort_event: threading.Event):
        """Wait ms milliseconds, but check abort every 200ms."""
        steps = max(1, ms // 200)
        step_ms = ms // steps
        for _ in range(steps):
            if abort_event.is_set():
                return
            try:
                page.wait_for_timeout(step_ms)
            except Exception:
                return

    def _fetch(self, browser, url: str, budget_secs: int,
               abort_event: threading.Event) -> Optional[str]:
        context = None
        page    = None
        try:
            if abort_event.is_set():
                return None

            context = browser.new_context(
                viewport={'width': 1280, 'height': 800},
                user_agent=(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/120.0.0.0 Safari/537.36'
                ),
                ignore_https_errors=True,
            )
            page = context.new_page()

            with self._page_lock:
                self._cur_page    = page
                self._cur_context = context

            if abort_event.is_set():
                return None

            # Navigate — try domcontentloaded first, fall back gracefully
            nav_ms = min(20000, budget_secs * 700)
            try:
                page.goto(url, timeout=nav_ms, wait_until='domcontentloaded')
            except Exception as e:
                if abort_event.is_set():
                    return None
                # On timeout still try to extract — partial load may have emails
                print(f"[Browser] nav partial: {type(e).__name__}")

            if abort_event.is_set():
                return None

            # JS hydration — wait for frameworks to render
            self._safe_wait(page, 2500, abort_event)
            if abort_event.is_set():
                return None

            # Scroll to bottom — triggers lazy-loaded footers (where mailto links live)
            try:
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                self._safe_wait(page, 800, abort_event)
                # Scroll back to top then bottom again to catch infinite-scroll footers
                page.evaluate("window.scrollTo(0, 0)")
                self._safe_wait(page, 400, abort_event)
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                self._safe_wait(page, 600, abort_event)
            except Exception:
                pass

            if abort_event.is_set():
                return None

            # Extra wait if body is sparse (SPA still loading)
            try:
                blen = page.evaluate(
                    "document.body ? document.body.innerText.trim().length : 0"
                )
                if blen < 300:
                    self._safe_wait(page, 2500, abort_event)
            except Exception:
                pass

            if abort_event.is_set():
                return None

            # Wait for mailto links — longer timeout since footer may load late
            try:
                page.wait_for_selector('a[href*="mailto"]', timeout=5000)
            except Exception:
                pass  # fine if none — we still extract everything else

            if abort_event.is_set():
                return None

            # Dismiss cookie banners
            for sel in [
                'button:has-text("Accept All")',
                'button:has-text("Accept Cookies")',
                'button:has-text("Accept")',
                'button:has-text("Agree")',
                'button:has-text("Allow All")',
                'button:has-text("Allow")',
                'button:has-text("I Accept")',
                '[aria-label*="Accept"]',
                '[id*="accept-cookies"]',
                '[class*="cookie-accept"]',
            ]:
                if abort_event.is_set():
                    return None
                try:
                    page.locator(sel).first.click(timeout=400)
                    self._safe_wait(page, 300, abort_event)
                    break
                except Exception:
                    pass

            if abort_event.is_set():
                return None

            # Final scroll to bottom — ensures lazy-loaded footers are rendered
            # (mailto: links are almost always in the footer)
            try:
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                self._safe_wait(page, 1000, abort_event)
            except Exception:
                pass

            if abort_event.is_set():
                return None

            # Direct JS extraction — runs AFTER scroll so footer content is loaded
            # Uses Set() so no duplicates; covers mailto hrefs, visible text,
            # body innerText, and data-* attributes
            js_emails = []
            try:
                js_code = (
                    '() => {'
                    ' const em = new Set();'
                    ' const re = /[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g;'
                    # A: all <a href="mailto:..."> — highest priority
                    ' document.querySelectorAll("a[href]").forEach(a => {'
                    '   const h = a.getAttribute("href") || "";'
                    '   if (h.toLowerCase().indexOf("mailto:") !== -1) {'
                    '     const e = h.replace(/^.*mailto:/i,"").split("?")[0].trim();'
                    '     if (e) em.add(e);'
                    '   }'
                    '   const t = (a.innerText||a.textContent||"").trim();'
                    '   if (t.indexOf("@") !== -1 && t.length < 120) em.add(t);'
                    ' });'
                    # B: visible text in common elements incl footer/section
                    ' document.querySelectorAll("a,p,div,span,li,td,th,address,footer,section").forEach(el=>{'
                    '   const t=(el.childNodes.length===1&&el.childNodes[0].nodeType===3)'
                    '     ?(el.innerText||el.textContent||"").trim():"";'
                    '   if(t && t.indexOf("@")!==-1){const f=t.match(re);if(f)f.forEach(e=>em.add(e));}'
                    ' });'
                    # C: full body innerText scan
                    ' const bm=(document.body.innerText||"").match(re)||[];'
                    ' bm.forEach(e=>em.add(e));'
                    # D: data-email / data-contact / data-mail attributes
                    ' document.querySelectorAll("[data-email],[data-contact],[data-mail]").forEach(el=>{'
                    '   ["data-email","data-contact","data-mail"].forEach(attr=>{'
                    '     const v=el.getAttribute(attr);'
                    '     if(v && v.indexOf("@")!==-1) em.add(v);'
                    '   });'
                    ' });'
                    ' return [...em];'
                    '}'
                )
                js_emails = page.evaluate(js_code) or []
            except Exception:
                js_emails = []

            if abort_event.is_set():
                return None

            # Serialize full rendered HTML (source as browser sees it)
            try:
                html = page.content() or ''
            except Exception:
                html = ''

            # Inject JS-found emails as hidden mailto anchors so BeautifulSoup
            # finds them even if page.content() serialised before footer loaded
            if js_emails and html:
                inj = '<div id="_hem_" style="display:none">'
                for e in js_emails:
                    inj += f'<a href="mailto:{e}">{e}</a>'
                inj += '</div>'
                html = html.replace('</body>', inj + '</body>') if '</body>' in html else html + inj

            print(f"[Browser] ✓ {url} ({len(html):,}ch, {len(js_emails)} JS emails)")
            return html or None

        except Exception as e:
            if not abort_event.is_set():
                print(f"[Browser] ✗ {url}: {e}")
            return None
        finally:
            with self._page_lock:
                self._cur_page    = None
                self._cur_context = None
            try:
                if page:    page.close()
            except Exception:
                pass
            try:
                if context: context.close()
            except Exception:
                pass


# Global single browser thread
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


# ─────────────────────────────────────────────────────────────────────────────
# Email regex & reject lists
# ─────────────────────────────────────────────────────────────────────────────
EMAIL_RE = re.compile(
    r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}',
    re.IGNORECASE,
)
MAILTO_RE = re.compile(
    r'mailto:["\']?\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})',
    re.IGNORECASE,
)

REJECT_TLDS = {
    'png','jpg','jpeg','gif','svg','webp','ico','bmp','tiff',
    'pdf','css','js','jsx','ts','tsx','json','xml','zip','gz',
    'woff','woff2','ttf','eot','otf','map','mp4','mp3','wav',
    'cat',                    # @2x.cat image filename false-positives
    'pbz','bet','arg','rqh',  # ROT13 of com/org/net/edu
}

REJECT_LOCALS_EXACT = {
    'noreply','no-reply','donotreply','do-not-reply',
    'unsubscribe','bounce','mailer-daemon','postmaster',
    'abuse','spam','webmaster','root','www',
}

REJECT_DOMAINS = {
    'example.com','test.com','localhost','domain.com',
    'yourdomain.com','email.com','website.com','yoursite.com',
    'sentry.io','sentry-next.wixpress.com','2x.cat',
}

IMAGE_FILENAME_RE = re.compile(
    r'(logo|icon|image|img|banner|bg|background|sprite|thumb|photo|'
    r'avatar|favicon|placeholder|hero|cover|tile|asset|graphic).*@\d',
    re.IGNORECASE,
)

CONTACT_PATTERNS = re.compile(
    r'/(contact|about|support|help|team|staff|reach|connect|'
    r'get-in-touch|hire|press|media)',
    re.IGNORECASE,
)

# ─────────────────────────────────────────────────────────────────────────────
# Obfuscation decoders
# ─────────────────────────────────────────────────────────────────────────────

def decode_at_dot(text: str) -> str:
    t = re.sub(r'\s*\[at\]\s*',  '@', text, flags=re.IGNORECASE)
    t = re.sub(r'\s*\(at\)\s*',  '@', t,    flags=re.IGNORECASE)
    t = re.sub(r'\s*\[dot\]\s*', '.', t,    flags=re.IGNORECASE)
    t = re.sub(r'\s*\(dot\)\s*', '.', t,    flags=re.IGNORECASE)
    t = re.sub(r'(?<=\w)\s+at\s+(?=\w)',  '@', t, flags=re.IGNORECASE)
    t = re.sub(r'(?<=\w)\s+dot\s+(?=\w)', '.', t, flags=re.IGNORECASE)
    return t

def decode_html_entities(text: str) -> str:
    from html import unescape
    return unescape(text)

def decode_unicode_lookalikes(text: str) -> str:
    for src, dst in [('\uff20','@'), ('\u2024','.'), ('\uff0e','.')]:
        text = text.replace(src, dst)
    return text


# ─────────────────────────────────────────────────────────────────────────────
# Email validation
# ─────────────────────────────────────────────────────────────────────────────

def normalize_email(raw: str) -> Optional[str]:
    if not raw:
        return None
    email = raw.strip().strip('"\'<>(),;:[]{}').lower()
    if not email or '@' not in email or len(email) > 254:
        return None
    parts = email.split('@')
    if len(parts) != 2:
        return None
    local, domain = parts
    if '/' in email or '\\' in email:
        return None
    if '..' in local or '..' in domain:
        return None
    tld = domain.rsplit('.', 1)[-1] if '.' in domain else ''
    if tld in REJECT_TLDS:
        return None
    if '.' not in domain:
        return None
    if re.search(r'@\d+x?$', email):
        return None
    if IMAGE_FILENAME_RE.search(email):
        return None
    if re.fullmatch(r'\d+', local):
        return None
    if re.fullmatch(r'[0-9a-f]{8,}', local):
        return None
    if local in REJECT_LOCALS_EXACT:
        return None
    if domain in REJECT_DOMAINS:
        return None
    if not EMAIL_RE.fullmatch(email):
        return None
    return email


def apply_exclusion_rules(emails: list, rules: list) -> list:
    out = []
    for email in emails:
        excluded = False
        for rule in rules:
            rule = rule.strip().lower()
            if not rule or rule.startswith('#'):
                continue
            if rule.startswith('@'):
                em_domain   = email.split('@')[1]
                domain_rule = rule[1:]
                if em_domain == domain_rule or em_domain.endswith('.' + domain_rule):
                    excluded = True; break
            elif '@' in rule:
                if email == rule:
                    excluded = True; break
            else:
                if rule in email.split('@')[0]:
                    excluded = True; break
        if not excluded:
            out.append(email)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Email extraction
# ─────────────────────────────────────────────────────────────────────────────

def extract_from_html(html: str, source: str = 'html') -> list:
    results = []
    # mailto: href → HIGH
    for m in MAILTO_RE.findall(html):
        n = normalize_email(m)
        if n:
            results.append({'email': n, 'confidence': 'high', 'source': 'mailto-href'})
    # General scan → MEDIUM
    for m in EMAIL_RE.findall(html):
        n = normalize_email(m)
        if n:
            results.append({'email': n, 'confidence': 'medium', 'source': source})
    # HTML entities
    dec = decode_html_entities(html)
    if dec != html:
        for m in EMAIL_RE.findall(dec):
            n = normalize_email(m)
            if n:
                results.append({'email': n, 'confidence': 'medium', 'source': 'entities'})
    # AT/DOT obfuscation
    obf = decode_at_dot(html)
    if obf != html:
        for m in EMAIL_RE.findall(obf):
            n = normalize_email(m)
            if n:
                results.append({'email': n, 'confidence': 'low', 'source': 'at-dot'})
    # Unicode lookalikes
    uni = decode_unicode_lookalikes(html)
    if uni != html:
        for m in EMAIL_RE.findall(uni):
            n = normalize_email(m)
            if n:
                results.append({'email': n, 'confidence': 'low', 'source': 'unicode'})
    return results


def extract_from_soup(soup: BeautifulSoup) -> list:
    results = []
    # mailto: anchors → HIGH
    for a in soup.find_all('a', href=True):
        href = a.get('href', '')
        if href.lower().startswith('mailto:'):
            n = normalize_email(href[7:].split('?')[0])
            if n:
                results.append({'email': n, 'confidence': 'high', 'source': 'mailto-dom'})
            n2 = normalize_email(a.get_text(strip=True))
            if n2:
                results.append({'email': n2, 'confidence': 'high', 'source': 'mailto-text'})
    # JSON-LD → HIGH
    for script in soup.find_all('script', type='application/ld+json'):
        try:
            for m in EMAIL_RE.findall(json.dumps(json.loads(script.string or ''))):
                n = normalize_email(m)
                if n:
                    results.append({'email': n, 'confidence': 'high', 'source': 'json-ld'})
        except Exception:
            pass
    # meta → MEDIUM
    for meta in soup.find_all('meta', content=True):
        for m in EMAIL_RE.findall(meta.get('content', '')):
            n = normalize_email(m)
            if n:
                results.append({'email': n, 'confidence': 'medium', 'source': 'meta'})
    # microdata → HIGH
    for el in soup.find_all(itemprop='email'):
        n = normalize_email(el.get_text(strip=True) or el.get('content', ''))
        if n:
            results.append({'email': n, 'confidence': 'high', 'source': 'microdata'})
    # data-* → MEDIUM
    for el in soup.find_all(True):
        for attr in ['data-email','data-contact','data-mail','data-mailto']:
            for m in EMAIL_RE.findall(el.get(attr, '')):
                n = normalize_email(m)
                if n:
                    results.append({'email': n, 'confidence': 'medium', 'source': 'data-attr'})
    # body text + AT/DOT → MEDIUM
    body = decode_at_dot(decode_html_entities(soup.get_text(separator=' ')))
    for m in EMAIL_RE.findall(body):
        n = normalize_email(m)
        if n:
            results.append({'email': n, 'confidence': 'medium', 'source': 'body-text'})
    return results


def dedupe_results(results: list, cap: int = 20) -> list:
    order = {'high': 0, 'medium': 1, 'low': 2}
    seen  = {}
    for r in results:
        e = r['email']
        if e not in seen or order[r['confidence']] < order[seen[e]['confidence']]:
            seen[e] = r
    return sorted(seen.values(), key=lambda x: (order[x['confidence']], x['email']))[:cap]


def discover_secondary_urls(html: str, base_url: str, visited: set, limit: int = 3) -> list:
    found       = []
    soup        = BeautifulSoup(html, 'html.parser')
    base_netloc = urllib.parse.urlparse(base_url).netloc
    for a in soup.find_all('a', href=True):
        if len(found) >= limit:
            break
        href = a.get('href', '').strip()
        if not href or href.startswith('#') or href.startswith('javascript:'):
            continue
        if not CONTACT_PATTERNS.search(href):
            continue
        full = urllib.parse.urljoin(base_url, href)
        p    = urllib.parse.urlparse(full)
        if p.netloc != base_netloc:
            continue
        clean = urllib.parse.urlunparse((p.scheme, p.netloc, p.path, '', '', ''))
        if clean not in visited and clean != base_url:
            found.append(clean)
            visited.add(clean)
    return found


# ─────────────────────────────────────────────────────────────────────────────
# HTTP fetch
# ─────────────────────────────────────────────────────────────────────────────
HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/120.0.0.0 Safari/537.36'
    ),
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Connection':      'keep-alive',
}

def fetch_url_requests(url: str, timeout: int = 12) -> Optional[str]:
    """
    Fetch raw HTML source. Tries multiple URL variants (https/http, www/non-www)
    and returns the first successful response with substantial content.
    """
    parsed   = urllib.parse.urlparse(url)
    netloc   = parsed.netloc
    # Build candidate URLs: https, http, and www variants
    variants = [url]
    if url.startswith('https://'):
        variants.append('http://' + url[8:])
    if not netloc.startswith('www.'):
        www_url = f"{parsed.scheme}://www.{netloc}"
        variants.append(www_url)
        if url.startswith('https://'):
            variants.append('http://www.' + netloc)

    best = None
    for try_url in variants:
        try:
            r = requests.get(try_url, headers=HEADERS, timeout=timeout,
                             allow_redirects=True)
            r.encoding = r.apparent_encoding or 'utf-8'
            text = r.text
            # Prefer responses with actual content
            if text and len(text) > (len(best) if best else 0):
                best = text
                if len(text) > 5000:   # good enough, stop trying
                    break
        except Exception:
            continue
    return best or None


def normalize_url(raw: str) -> Optional[str]:
    raw = raw.strip()
    if not raw:
        return None
    if not raw.startswith(('http://', 'https://')):
        raw = 'https://' + raw
    try:
        p = urllib.parse.urlparse(raw)
        return f"{p.scheme}://{p.netloc}" if p.netloc else None
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Core scraper — abort_event is the universal kill switch
# ─────────────────────────────────────────────────────────────────────────────

def scrape_domain(url: str, exclusion_rules: list,
                  hard_timeout: int, abort_event: threading.Event) -> dict:
    """
    Scrape one domain. abort_event is the hard kill switch — checked before
    every blocking call so the hard timeout is always respected.
    Emails found before abort fires are still returned.
    """
    start       = time.time()
    all_results = []
    visited     = {url}

    def time_left() -> float:
        return max(0.0, hard_timeout - (time.time() - start))

    def aborted() -> bool:
        return abort_event.is_set()

    try:
        # ── Phase 1: Raw HTTP source-code fetch
        # Scans the server's raw HTML before any JS rendering. This catches:
        #   • mailto: links in server-rendered pages (WordPress, static sites)
        #   • Emails inside <script> tags and inline JS strings
        #   • Emails in HTML comments, <noscript>, data attributes
        # Scanned as both plain text (all email patterns) and parsed DOM.
        raw_html = None
        if not aborted():
            raw_html = fetch_url_requests(url, timeout=min(10, int(time_left())))
            if raw_html:
                all_results.extend(extract_from_html(raw_html, 'source-code'))
                all_results.extend(extract_from_soup(BeautifulSoup(raw_html, 'html.parser')))

        # ── Phase 2: Visible browser (renders JS/React/Next.js/Webflow)
        pw_html = None
        if not aborted() and time_left() > 8:
            bt = get_browser_thread()
            if bt:
                browser_budget = max(5, int(time_left()) - 4)
                pw_html = bt.fetch(url, browser_budget, abort_event)
                if pw_html and not aborted():
                    all_results.extend(extract_from_html(pw_html, 'browser-html'))
                    all_results.extend(extract_from_soup(BeautifulSoup(pw_html, 'html.parser')))

        # ── Phase 3: Secondary pages (contact/about/team/press)
        discovery_html = pw_html or raw_html
        if discovery_html and not aborted() and time_left() > 6:
            sec_urls = discover_secondary_urls(discovery_html, url, visited, limit=3)
            for sec_url in sec_urls:
                if aborted() or time_left() < 4:
                    break
                sec_raw = fetch_url_requests(sec_url, timeout=min(8, int(time_left())))
                if sec_raw and not aborted():
                    all_results.extend(extract_from_html(sec_raw, 'sec-raw'))
                    all_results.extend(extract_from_soup(BeautifulSoup(sec_raw, 'html.parser')))

        # ── Phase 4: Deduplicate + exclusions (always runs, returns whatever was found)
        if not all_results and not raw_html and not pw_html:
            return {'url': url, 'emails': [], 'status': 'no_content', 'error': 'Could not fetch'}

        deduped  = dedupe_results(all_results, cap=20)
        kept_set = set(apply_exclusion_rules([r['email'] for r in deduped], exclusion_rules))
        final    = [r for r in deduped if r['email'] in kept_set]

        # If aborted mid-scrape, mark as timeout but still return any emails found
        if aborted():
            status = 'skipped_timeout'
        else:
            status = 'success' if final else 'no_emails'

        return {'url': url, 'emails': final, 'status': status, 'error': ''}

    except Exception as e:
        return {'url': url, 'emails': [], 'status': 'skipped_error', 'error': str(e)}


# ─────────────────────────────────────────────────────────────────────────────
# Run state
# ─────────────────────────────────────────────────────────────────────────────

class RunState:
    def __init__(self):
        self.reset()

    def reset(self):
        self.run_id          = None
        self.urls            = []
        self.results         = {}
        self.next_index      = 0
        self.status          = 'idle'
        self.stop_requested  = False
        self.force_stop      = False
        self.skip_requested  = False
        self.exclusion_rules = []
        self.hard_timeout    = 45
        self.current_domain  = ''
        self.current_index   = 0
        self.total           = 0
        self.lock            = threading.Lock()

        # Per-URL abort event — set to kill current scrape immediately
        self.abort_event     = threading.Event()


RUN = RunState()


# ─────────────────────────────────────────────────────────────────────────────
# Background worker
#
# Hard timeout enforcement:
#   1. We create a fresh abort_event for each URL
#   2. We start a threading.Timer for exactly hard_timeout seconds
#   3. When the timer fires it:
#        - sets abort_event  → scrape_domain stops immediately
#        - kills browser page → bt.fetch() unblocks immediately
#   4. The same abort_event is triggered by Skip and Force Stop
#   5. After the timer fires, run_worker records the result and moves on
#   NO URL CAN EVER EXCEED hard_timeout SECONDS.
# ─────────────────────────────────────────────────────────────────────────────

def run_worker(run_id: str):
    while True:
        # ── Pick next URL ──────────────────────────────────────────────────
        with RUN.lock:
            if RUN.run_id != run_id:
                break
            if RUN.force_stop or RUN.stop_requested:
                RUN.status = 'paused'
                break
            if RUN.next_index >= len(RUN.urls):
                RUN.status = 'done'
                break
            idx = RUN.next_index
            url = RUN.urls[idx]
            RUN.current_index  = idx
            RUN.current_domain = url
            RUN.next_index    += 1
            hard_timeout       = RUN.hard_timeout
            excl_rules         = RUN.exclusion_rules

            # Fresh abort event for this URL
            abort_ev = threading.Event()
            RUN.abort_event = abort_ev

        # ── Check skip list BEFORE doing any work ─────────────────────────
        skip_list = load_skip_list()
        if url_in_skip_list(url, skip_list):
            print(f"[Worker] ⏭ {url} is in skip_domains.txt — skipping")
            with RUN.lock:
                RUN.results[url] = {
                    'url':    url,
                    'emails': [],
                    'status': 'skip-listed',
                    'error':  'Domain in skip_domains.txt (timed out on previous run)',
                }
            continue

        # ── Write this domain to skip list NOW (before processing)
        # If the app crashes, is killed, or times out, it will already be
        # in the file so next run skips it. Removed below if it succeeds.
        add_to_skip_list(url)
        print(f"[Worker] 📝 Pre-added {url} to skip list (will remove on success)")

        result_holder = [None]
        scrape_done   = threading.Event()

        def do_scrape(u=url, ae=abort_ev, ht=hard_timeout, er=excl_rules):
            result_holder[0] = scrape_domain(u, er, ht, ae)
            scrape_done.set()

        scrape_thread = threading.Thread(target=do_scrape, daemon=True)

        # ── Hard timeout timer ─────────────────────────────────────────────
        def on_timeout(ae=abort_ev, u=url):
            print(f"[Worker] ⏰ Hard timeout ({hard_timeout}s) — aborting {u}")
            ae.set()
            bt = get_browser_thread()
            if bt:
                bt.kill_current_page()

        timer = threading.Timer(hard_timeout, on_timeout)

        # ── Start both ─────────────────────────────────────────────────────
        timer.start()
        scrape_thread.start()

        # ── Wait loop — checks skip/force_stop every 0.3s ──────────────────
        timed_out = False
        while not scrape_done.is_set():
            time.sleep(0.3)

            with RUN.lock:
                force  = RUN.force_stop
                skip   = RUN.skip_requested

            if force or skip:
                print(f"[Worker] {'Force stop' if force else 'Skip'} — aborting {url}")
                abort_ev.set()
                bt = get_browser_thread()
                if bt:
                    bt.kill_current_page()
                with RUN.lock:
                    RUN.skip_requested = False
                scrape_done.wait(timeout=3)
                break

            # Detect if timer already fired (abort_ev set but scrape not done yet)
            if abort_ev.is_set() and not scrape_done.is_set():
                timed_out = True
                scrape_done.wait(timeout=3)
                break

        timer.cancel()

        # ── Record result ──────────────────────────────────────────────────
        if result_holder[0] is not None:
            result = result_holder[0]
        else:
            result = {
                'url':    url,
                'emails': [],
                'status': 'skipped_timeout',
                'error':  f'Hard timeout after {hard_timeout}s — added to skip_domains.txt',
            }

        # ── Remove from skip list if completed without timeout ──────────────
        # (It was pre-added above; only keep it if it actually timed out)
        if result.get('status') not in ('skipped_timeout',):
            remove_from_skip_list(url)
        else:
            print(f"[Worker] ⏰ {url} timed out — keeping in skip_domains.txt")

        with RUN.lock:
            RUN.results[url] = result

        # ── Check stop after recording ─────────────────────────────────────
        with RUN.lock:
            if RUN.force_stop or RUN.stop_requested:
                RUN.status = 'paused'
                break

    stop_browser_thread()


# ─────────────────────────────────────────────────────────────────────────────
# Flask routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/start', methods=['POST'])
def api_start():
    data         = request.get_json(force=True)
    raw_urls     = data.get('urls', [])
    excl_text    = data.get('exclusion_rules', '')
    hard_timeout = int(data.get('hard_timeout', 45))

    urls = []
    seen = set()
    for raw in raw_urls:
        n = normalize_url(raw)
        if n and n not in seen:
            urls.append(n)
            seen.add(n)

    if not urls:
        return jsonify({'ok': False, 'error': 'No valid URLs provided'})

    excl_rules = [
        r.strip() for r in excl_text.splitlines()
        if r.strip() and not r.strip().startswith('#')
    ]

    if PLAYWRIGHT_AVAILABLE:
        threading.Thread(target=get_browser_thread, daemon=True).start()

    with RUN.lock:
        RUN.reset()
        RUN.run_id          = str(uuid.uuid4())
        RUN.urls            = urls
        RUN.total           = len(urls)
        RUN.status          = 'running'
        RUN.exclusion_rules = excl_rules
        RUN.hard_timeout    = hard_timeout
        run_id              = RUN.run_id

    threading.Thread(target=run_worker, args=(run_id,), daemon=True).start()
    return jsonify({'ok': True, 'run_id': run_id, 'total': len(urls),
                    'playwright': PLAYWRIGHT_AVAILABLE})


@app.route('/api/continue', methods=['POST'])
def api_continue():
    with RUN.lock:
        if RUN.status not in ('paused', 'idle'):
            return jsonify({'ok': False, 'error': 'Run is not paused'})
        if not RUN.urls:
            return jsonify({'ok': False, 'error': 'No run to continue'})
        RUN.stop_requested = False
        RUN.force_stop     = False
        RUN.status         = 'running'
        run_id             = RUN.run_id

    if PLAYWRIGHT_AVAILABLE:
        threading.Thread(target=get_browser_thread, daemon=True).start()
    threading.Thread(target=run_worker, args=(run_id,), daemon=True).start()
    return jsonify({'ok': True})


@app.route('/api/stop', methods=['POST'])
def api_stop():
    with RUN.lock:
        RUN.stop_requested = True
        abort_ev = RUN.abort_event
    # Abort current scrape so stop takes effect immediately
    abort_ev.set()
    bt = get_browser_thread()
    if bt:
        bt.kill_current_page()
    return jsonify({'ok': True})


@app.route('/api/force_stop', methods=['POST'])
def api_force_stop():
    with RUN.lock:
        RUN.force_stop     = True
        RUN.stop_requested = True
        abort_ev = RUN.abort_event
    abort_ev.set()
    bt = get_browser_thread()
    if bt:
        bt.kill_current_page()
    return jsonify({'ok': True})


@app.route('/api/skip', methods=['POST'])
def api_skip():
    with RUN.lock:
        RUN.skip_requested = True
        abort_ev = RUN.abort_event
    # Abort current scrape — worker will record whatever was found and move on
    abort_ev.set()
    bt = get_browser_thread()
    if bt:
        bt.kill_current_page()
    return jsonify({'ok': True})


@app.route('/api/reset', methods=['POST'])
def api_reset():
    with RUN.lock:
        abort_ev = RUN.abort_event
        RUN.reset()
    abort_ev.set()
    threading.Thread(target=stop_browser_thread, daemon=True).start()
    return jsonify({'ok': True})


@app.route('/api/skiplist', methods=['GET'])
def api_skiplist_get():
    """Return current skip list domains."""
    domains = sorted(load_skip_list())
    return jsonify({'ok': True, 'domains': domains, 'file': SKIP_LIST_FILE})


@app.route('/api/skiplist/clear', methods=['POST'])
def api_skiplist_clear():
    """Clear the skip list file."""
    try:
        with open(SKIP_LIST_FILE, 'w', encoding='utf-8') as f:
            f.write('# Domains that timed out — auto-populated by Email Harvester\n')
            f.write('# Add any domain here (one per line) to skip it on next run\n')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})


@app.route('/api/skiplist/remove', methods=['POST'])
def api_skiplist_remove():
    """Remove a specific domain from the skip list."""
    data   = request.get_json(force=True)
    domain = data.get('domain', '').strip().lower()
    if not domain:
        return jsonify({'ok': False, 'error': 'No domain provided'})
    try:
        existing = load_skip_list()
        existing.discard(domain)
        with open(SKIP_LIST_FILE, 'w', encoding='utf-8') as f:
            f.write('# Domains that timed out — auto-populated by Email Harvester\n')
            for d in sorted(existing):
                f.write(d + '\n')
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)})


@app.route('/api/status')
def api_status():
    with RUN.lock:
        results_list = [RUN.results[u] for u in RUN.urls if u in RUN.results]
        return jsonify({
            'ok':             True,
            'status':         RUN.status,
            'current_index':  RUN.current_index,
            'total':          RUN.total,
            'current_domain': RUN.current_domain,
            'results':        results_list,
            'playwright':     PLAYWRIGHT_AVAILABLE,
        })


if __name__ == '__main__':
    mode = ("VISIBLE BROWSER (Playwright)" if PLAYWRIGHT_AVAILABLE
            else "HTTP only — run: pip install playwright && python -m playwright install chromium")
    print("=" * 64)
    print("  Bulk Email Harvester")
    print(f"  Mode : {mode}")
    print("  Open : http://127.0.0.1:5000")
    print("=" * 64)
    app.run(debug=False, port=5000, threaded=True)
