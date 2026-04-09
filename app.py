#!/usr/bin/env python3
"""Web UI email scraper with file-backed pending queue and headed-browser opening."""

from __future__ import annotations

import argparse
import base64
import codecs
import csv
import html
import json
import logging
import random
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template_string, request

try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except Exception:
    PLAYWRIGHT_AVAILABLE = False

INPUT_FILE = Path("input.txt")
PENDING_FILE = Path("pending.txt")
OUTPUT_FILE = Path("output.csv")
ERROR_FILE = Path("errors.log")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]
CONTACT_HINTS = ("contact", "about", "team", "support")
EMAIL_REGEX = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,63}")
MAILTO_REGEX = re.compile(r"mailto:([^\s'\"?#>]+)", re.IGNORECASE)

REJECT_TLDS = {
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tiff", "pdf", "css", "js", "jsx",
    "ts", "tsx", "json", "xml", "zip", "gz", "woff", "woff2", "ttf", "eot", "otf", "map",
    "mp4", "mp3", "wav", "cat", "pbz", "bet", "arg", "rqh",
}
REJECT_LOCAL_PARTS = {
    "noreply", "no-reply", "donotreply", "do-not-reply", "unsubscribe", "bounce", "mailer-daemon",
    "postmaster", "abuse", "spam", "webmaster", "root", "www",
}
REJECT_DOMAINS = {
    "example.com", "test.com", "localhost", "domain.com", "yourdomain.com", "email.com", "website.com",
    "yoursite.com", "sentry.io", "sentry-next.wixpress.com", "2x.cat",
}
REJECT_IMAGE_PATTERN = re.compile(r"(logo|icon|image|img|banner|bg|background|sprite|thumb|photo|avatar|favicon|placeholder|hero|cover|tile|asset|graphic).*@\d", re.I)


@dataclass
class SiteResult:
    domain: str
    emails: list[str]
    failed: bool
    reason: str = ""


class PendingQueue:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()
        self.pending = self._load()

    def _load(self) -> set[str]:
        if not self.path.exists():
            return set()
        return {x.strip() for x in self.path.read_text(encoding="utf-8").splitlines() if x.strip()}

    def snapshot(self) -> set[str]:
        with self.lock:
            return set(self.pending)

    def add(self, url: str) -> None:
        with self.lock:
            self.pending.add(url)
            self._flush()

    def remove(self, url: str) -> None:
        with self.lock:
            self.pending.discard(url)
            self._flush()

    def _flush(self) -> None:
        data = "\n".join(sorted(self.pending))
        self.path.write_text(data + ("\n" if data else ""), encoding="utf-8")


class HeadedBrowser:
    def __init__(self) -> None:
        self.enabled = PLAYWRIGHT_AVAILABLE
        self.lock = threading.Lock()

    def open_page(self, url: str, timeout: int) -> None:
        if not self.enabled:
            return
        with self.lock:
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=False)
                    page = browser.new_page()
                    page.goto(url, timeout=timeout * 1000, wait_until="domcontentloaded")
                    page.wait_for_timeout(1200)
                    browser.close()
            except Exception as exc:
                logging.exception("Headed browser open failed for %s", url, exc_info=exc)


class EmailScraper:
    def __init__(self, timeout: int, max_pages: int, exclude_emails: set[str], exclude_domains: set[str], open_headed: bool) -> None:
        self.timeout = timeout
        self.max_pages = max_pages
        self.exclude_emails = {e.lower() for e in exclude_emails}
        self.exclude_domains = {d.lower().lstrip('@') for d in exclude_domains}
        self.browser = HeadedBrowser()
        self.open_headed = open_headed

    def process_site(self, website: str) -> SiteResult:
        url = normalize_url(website)
        domain = urlparse(url).netloc.lower()
        if self.open_headed:
            self.browser.open_page(url, self.timeout)
        if not self._robots_allowed(url):
            logging.warning("robots disallow for %s", url)

        found = set()
        for page in self._discover_pages(url):
            if self.open_headed:
                self.browser.open_page(page, self.timeout)
            html_text, soup = self._fetch(page)
            if not html_text or soup is None:
                continue
            for method in (
                self.extract_mailto, self.extract_raw, self.extract_jsonld, self.extract_meta,
                self.extract_microdata, self.extract_data_attributes, self.extract_visible_text,
                self.extract_entities, self.extract_obfuscation,
            ):
                try:
                    found.update(method(html_text, soup))
                except Exception as exc:
                    logging.exception("extractor failed %s on %s", method.__name__, page, exc_info=exc)
        return SiteResult(domain=domain, emails=sorted(self.filter_emails(found)), failed=False)

    def _robots_allowed(self, url: str) -> bool:
        p = urlparse(url)
        parser = RobotFileParser()
        try:
            parser.set_url(f"{p.scheme}://{p.netloc}/robots.txt")
            parser.read()
            return parser.can_fetch("*", url)
        except Exception as exc:
            logging.exception("robots error for %s", url, exc_info=exc)
            return True

    def _fetch(self, url: str) -> tuple[Optional[str], Optional[BeautifulSoup]]:
        try:
            r = requests.get(url, timeout=min(15, self.timeout), headers={"User-Agent": random.choice(USER_AGENTS)})
            r.raise_for_status()
            return r.text, BeautifulSoup(r.text, "html.parser")
        except Exception as exc:
            logging.exception("fetch failed for %s", url, exc_info=exc)
            return None, None

    def _discover_pages(self, root_url: str) -> list[str]:
        pages = [root_url]
        parsed = urlparse(root_url)
        base = f"{parsed.scheme}://{parsed.netloc}/"
        for hint in CONTACT_HINTS:
            if len(pages) >= self.max_pages + 1:
                return pages
            pages.append(urljoin(base, hint))

        html_text, soup = self._fetch(root_url)
        if not html_text or soup is None:
            return pages[: self.max_pages + 1]

        for a in soup.select("a[href]"):
            href = a.get("href", "")
            if not any(h in href.lower() for h in CONTACT_HINTS):
                continue
            candidate = urljoin(root_url, href)
            cp = urlparse(candidate)
            if cp.netloc.lower() != parsed.netloc.lower():
                continue
            clean = f"{cp.scheme}://{cp.netloc}{cp.path}".rstrip("/")
            if clean and clean not in pages:
                pages.append(clean)
            if len(pages) >= self.max_pages + 1:
                break
        return pages[: self.max_pages + 1]

    def extract_mailto(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        return set(MAILTO_REGEX.findall(html_text))

    def extract_raw(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        return set(EMAIL_REGEX.findall(html_text))

    def extract_jsonld(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set()
        for node in soup.find_all("script", attrs={"type": "application/ld+json"}):
            payload = node.get_text(" ", strip=True)
            try:
                emails.update(EMAIL_REGEX.findall(json.dumps(json.loads(payload))))
            except Exception:
                emails.update(EMAIL_REGEX.findall(payload))
        return emails

    def extract_meta(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set()
        for meta in soup.find_all("meta"):
            content = meta.get("content")
            if content:
                emails.update(EMAIL_REGEX.findall(content))
        return emails

    def extract_microdata(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set()
        for node in soup.select('[itemprop="email"]'):
            emails.update(EMAIL_REGEX.findall(node.get_text(" ", strip=True)))
            for attr in ("content", "href"):
                if node.get(attr):
                    emails.update(EMAIL_REGEX.findall(node[attr]))
        return emails

    def extract_data_attributes(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set()
        for node in soup.find_all(True):
            for attr in ("data-email", "data-contact", "data-mail"):
                if node.get(attr):
                    emails.update(EMAIL_REGEX.findall(node[attr]))
        return emails

    def extract_visible_text(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        return set(EMAIL_REGEX.findall(decode_obfuscation(soup.get_text(" ", strip=True))))

    def extract_entities(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        return set(EMAIL_REGEX.findall(html.unescape(html_text)))

    def extract_obfuscation(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set(EMAIL_REGEX.findall(decode_obfuscation(html_text)))
        for token in re.findall(r"[A-Za-z0-9+/=]{12,}", html_text):
            if len(token) % 4 != 0:
                continue
            try:
                emails.update(EMAIL_REGEX.findall(base64.b64decode(token).decode("utf-8", errors="ignore")))
            except Exception:
                pass
        emails.update(EMAIL_REGEX.findall(codecs.decode(html_text, "rot_13")))
        emails.update(EMAIL_REGEX.findall(html_text[::-1]))
        return emails

    def filter_emails(self, emails: Iterable[str]) -> set[str]:
        valid = set()
        for raw in emails:
            e = raw.strip().strip(".,;:()[]<>{}\"'").lower()
            if not e or "@" not in e or not EMAIL_REGEX.fullmatch(e):
                continue
            if e in self.exclude_emails:
                continue
            local, domain = e.rsplit("@", 1)
            tld = domain.rsplit(".", 1)[-1] if "." in domain else ""
            if local in REJECT_LOCAL_PARTS:
                continue
            if domain in REJECT_DOMAINS:
                continue
            if domain in self.exclude_domains or any(domain.endswith(f".{d}") for d in self.exclude_domains):
                continue
            if tld in REJECT_TLDS or REJECT_IMAGE_PATTERN.search(e):
                continue
            valid.add(e)
        return valid


def decode_obfuscation(text: str) -> str:
    patterns = {
        r"\s*\[\s*at\s*\]\s*": "@",
        r"\s*\(\s*at\s*\)\s*": "@",
        r"\s+at\s+": "@",
        r"\s*\[\s*dot\s*\]\s*": ".",
        r"\s*\(\s*dot\s*\)\s*": ".",
        r"\s+dot\s+": ".",
        r"\s+AT\s+": "@",
        r"\s+DOT\s+": ".",
    }
    out = html.unescape(text)
    for p, rep in patterns.items():
        out = re.sub(p, rep, out, flags=re.IGNORECASE)
    return out


def normalize_url(raw: str) -> str:
    raw = raw.strip()
    if raw and not re.match(r"^https?://", raw, flags=re.I):
        return f"https://{raw}"
    return raw


def run_with_timeout(scraper: EmailScraper, site: str, timeout: int) -> SiteResult:
    result: dict[str, SiteResult] = {}
    exc: dict[str, Exception] = {}

    def worker() -> None:
        try:
            result["r"] = scraper.process_site(site)
        except Exception as err:
            exc["e"] = err

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join(timeout=timeout)
    domain = urlparse(normalize_url(site)).netloc.lower() or site
    if t.is_alive():
        return SiteResult(domain, [], True, "timeout")
    if "e" in exc:
        logging.exception("process failed for %s", site, exc_info=exc["e"])
        return SiteResult(domain, [], True, "error")
    return result["r"]


def load_sites(text_blob: str, uploaded_blob: str) -> list[str]:
    sites = [line.strip() for line in text_blob.splitlines() if line.strip()]
    sites.extend([line.strip() for line in uploaded_blob.splitlines() if line.strip() and not line.strip().startswith("#")])
    if INPUT_FILE.exists():
        sites.extend([x.strip() for x in INPUT_FILE.read_text(encoding="utf-8").splitlines() if x.strip() and not x.strip().startswith("#")])
    seen, ordered = set(), []
    for s in sites:
        n = normalize_url(s)
        if n and n not in seen:
            seen.add(n)
            ordered.append(n)
    return ordered


def write_csv(rows: list[SiteResult]) -> None:
    with OUTPUT_FILE.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["domain", "emails"])
        for row in rows:
            w.writerow([row.domain, ", ".join(row.emails)])


app = Flask(__name__)
logging.basicConfig(filename=ERROR_FILE, level=logging.ERROR, format="%(asctime)s %(levelname)s %(message)s")


@app.get("/")
def home():
    return render_template_string(Path("index.html").read_text(encoding="utf-8"), playwright_available=PLAYWRIGHT_AVAILABLE)


@app.post("/run")
def run_scrape():
    payload = request.get_json(force=True, silent=True) or {}
    websites_text = payload.get("websites", "")
    uploaded_text = payload.get("uploaded", "")
    timeout = int(payload.get("timeout", 45))
    continue_mode = bool(payload.get("continue", False))
    max_pages = int(payload.get("max_pages", 5))
    workers = int(payload.get("workers", 4))
    open_headed = bool(payload.get("open_headed", True))
    exclude_emails = {x.strip().lower() for x in payload.get("exclude_emails", "").split(",") if x.strip()}
    exclude_domains = {x.strip().lower() for x in payload.get("exclude_domains", "").split(",") if x.strip()}

    sites = load_sites(websites_text, uploaded_text)
    queue = PendingQueue(PENDING_FILE)
    prior_pending = queue.snapshot()
    if not continue_mode:
        sites = [s for s in sites if s not in prior_pending]

    scraper = EmailScraper(timeout, max(0, max_pages), exclude_emails, exclude_domains, open_headed)
    results, failed = [], 0

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        future_map = {}
        for site in sites:
            queue.add(site)
            future_map[executor.submit(run_with_timeout, scraper, site, timeout)] = site

        for future in as_completed(future_map):
            site = future_map[future]
            try:
                row = future.result()
            except Exception as exc:
                logging.exception("future crash for %s", site, exc_info=exc)
                row = SiteResult(urlparse(site).netloc.lower(), [], True, "error")
            if row.failed:
                failed += 1
            else:
                queue.remove(site)
            results.append(row)

    ok = [r for r in results if not r.failed]
    write_csv(ok)
    return jsonify({
        "results": [{"domain": r.domain, "emails": r.emails, "failed": r.failed, "reason": r.reason} for r in results],
        "summary": {
            "sites_processed": len(results),
            "emails_found": sum(len(r.emails) for r in ok),
            "sites_failed": failed,
            "playwright_available": PLAYWRIGHT_AVAILABLE,
        },
    })


def cli() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=5000)
    p.add_argument("--debug", action="store_true")
    return p.parse_args()


if __name__ == "__main__":
    args = cli()
    app.run(host=args.host, port=args.port, debug=args.debug)
