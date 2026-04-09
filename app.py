#!/usr/bin/env python3
"""Production-ready CLI email scraper with resilient queueing."""

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

INPUT_FILE = Path("input.txt")
PENDING_FILE = Path("pending.txt")
OUTPUT_FILE = Path("output.csv")
ERROR_FILE = Path("errors.log")

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
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

REJECT_IMAGE_PATTERN = re.compile(
    r"(logo|icon|image|img|banner|bg|background|sprite|thumb|photo|avatar|favicon|"
    r"placeholder|hero|cover|tile|asset|graphic).*@\d",
    re.IGNORECASE,
)


@dataclass
class SiteResult:
    domain: str
    emails: list[str]
    failed: bool
    reason: Optional[str] = None


class PendingQueue:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._pending = self._load()

    def _load(self) -> set[str]:
        if not self.path.exists():
            return set()
        return {line.strip() for line in self.path.read_text(encoding="utf-8").splitlines() if line.strip()}

    def snapshot(self) -> set[str]:
        with self._lock:
            return set(self._pending)

    def add(self, url: str) -> None:
        with self._lock:
            self._pending.add(url)
            self._flush()

    def remove(self, url: str) -> None:
        with self._lock:
            self._pending.discard(url)
            self._flush()

    def _flush(self) -> None:
        lines = "\n".join(sorted(self._pending))
        self.path.write_text(lines + ("\n" if lines else ""), encoding="utf-8")


class EmailScraper:
    def __init__(
        self,
        timeout: int,
        max_pages: int,
        exclude_emails: set[str],
        exclude_domains: set[str],
    ) -> None:
        self.timeout = timeout
        self.max_pages = max_pages
        self.exclude_emails = {e.lower() for e in exclude_emails if e}
        self.exclude_domains = {d.lower().lstrip("@") for d in exclude_domains if d}

    def process_website(self, raw_url: str) -> SiteResult:
        url = normalize_url(raw_url)
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        if not self._robots_allowed(url):
            print(f"[WARN] robots.txt disallows scraping for {domain}; continuing gracefully.")

        discovered = self._discover_pages(url)
        all_emails: set[str] = set()

        for page in discovered:
            html_text, soup = self._fetch_page(page)
            if not html_text or soup is None:
                continue
            for extractor in (
                self.extract_from_mailto,
                self.extract_from_raw_html,
                self.extract_from_json_ld,
                self.extract_from_meta,
                self.extract_from_microdata,
                self.extract_from_data_attributes,
                self.extract_from_visible_text,
                self.extract_from_entities,
                self.extract_from_obfuscation,
            ):
                try:
                    all_emails.update(extractor(html_text, soup))
                except Exception as exc:  # defensive per-strategy logging
                    logging.exception("Extractor failure on %s with %s", page, extractor.__name__, exc_info=exc)

        clean = sorted(self.filter_emails(all_emails))
        return SiteResult(domain=domain, emails=clean, failed=False)

    def _fetch_page(self, url: str) -> tuple[Optional[str], Optional[BeautifulSoup]]:
        headers = {"User-Agent": random.choice(USER_AGENTS)}
        try:
            response = requests.get(url, timeout=min(15, self.timeout), headers=headers)
            response.raise_for_status()
            text = response.text
            return text, BeautifulSoup(text, "html.parser")
        except Exception as exc:
            logging.exception("Failed fetching %s", url, exc_info=exc)
            return None, None

    def _robots_allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        parser = RobotFileParser()
        try:
            parser.set_url(robots_url)
            parser.read()
            return parser.can_fetch("*", url)
        except Exception as exc:
            logging.exception("robots.txt check failed for %s", url, exc_info=exc)
            print(f"[WARN] Could not read robots.txt for {parsed.netloc}; continuing.")
            return True

    def _discover_pages(self, root_url: str) -> list[str]:
        urls = [root_url]
        parsed_root = urlparse(root_url)
        base = f"{parsed_root.scheme}://{parsed_root.netloc}"

        # deterministic fallback paths
        for hint in CONTACT_HINTS:
            if len(urls) >= self.max_pages + 1:
                return urls
            urls.append(urljoin(base + "/", hint))

        html_text, soup = self._fetch_page(root_url)
        if not html_text or soup is None:
            return urls[: self.max_pages + 1]

        for anchor in soup.select("a[href]"):
            href = anchor.get("href", "")
            if not any(h in href.lower() for h in CONTACT_HINTS):
                continue
            absolute = urljoin(root_url, href)
            parsed = urlparse(absolute)
            if parsed.netloc.lower() != parsed_root.netloc.lower():
                continue
            clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")
            if clean and clean not in urls:
                urls.append(clean)
            if len(urls) >= self.max_pages + 1:
                break
        return urls[: self.max_pages + 1]

    def extract_from_mailto(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        return set(MAILTO_REGEX.findall(html_text))

    def extract_from_raw_html(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        return set(EMAIL_REGEX.findall(html_text))

    def extract_from_json_ld(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set()
        for node in soup.find_all("script", attrs={"type": "application/ld+json"}):
            raw = node.get_text(" ", strip=True)
            if not raw:
                continue
            try:
                parsed = json.loads(raw)
                blob = json.dumps(parsed)
                emails.update(EMAIL_REGEX.findall(blob))
            except json.JSONDecodeError:
                emails.update(EMAIL_REGEX.findall(raw))
        return emails

    def extract_from_meta(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set()
        for meta in soup.find_all("meta"):
            content = meta.get("content")
            if content:
                emails.update(EMAIL_REGEX.findall(content))
        return emails

    def extract_from_microdata(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set()
        for node in soup.select('[itemprop="email"]'):
            emails.update(EMAIL_REGEX.findall(node.get_text(" ", strip=True)))
            for attr in ("content", "href"):
                value = node.get(attr)
                if value:
                    emails.update(EMAIL_REGEX.findall(value))
        return emails

    def extract_from_data_attributes(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        emails = set()
        for node in soup.find_all(True):
            for attr in ("data-email", "data-contact", "data-mail"):
                value = node.get(attr)
                if value:
                    emails.update(EMAIL_REGEX.findall(value))
        return emails

    def extract_from_visible_text(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        text = soup.get_text(" ", strip=True)
        normalized = decode_at_dot_obfuscation(text)
        return set(EMAIL_REGEX.findall(normalized))

    def extract_from_entities(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        decoded = html.unescape(html_text)
        return set(EMAIL_REGEX.findall(decoded))

    def extract_from_obfuscation(self, html_text: str, soup: BeautifulSoup) -> set[str]:
        candidates = set()
        decoded = decode_at_dot_obfuscation(html_text)
        candidates.update(EMAIL_REGEX.findall(decoded))

        for token in re.findall(r"[A-Za-z0-9+/=]{12,}", html_text):
            if len(token) % 4 != 0:
                continue
            try:
                plain = base64.b64decode(token).decode("utf-8", errors="ignore")
                candidates.update(EMAIL_REGEX.findall(plain))
            except Exception:
                continue

        rot13 = codecs.decode(decoded, "rot_13")
        candidates.update(EMAIL_REGEX.findall(rot13))

        reversed_blob = decoded[::-1]
        candidates.update(EMAIL_REGEX.findall(reversed_blob))
        return candidates

    def filter_emails(self, emails: Iterable[str]) -> set[str]:
        valid = set()
        for raw in emails:
            email = raw.strip().strip(".,;:()[]<>{}\"'").lower()
            if not email or "@" not in email:
                continue
            if email in self.exclude_emails:
                continue
            local, domain = email.rsplit("@", 1)
            domain = domain.strip(".")
            tld = domain.rsplit(".", 1)[-1] if "." in domain else ""

            if not domain or not local:
                continue
            if local in REJECT_LOCAL_PARTS:
                continue
            if domain in REJECT_DOMAINS or domain in self.exclude_domains:
                continue
            if any(domain == d or domain.endswith(f".{d}") for d in self.exclude_domains):
                continue
            if tld in REJECT_TLDS:
                continue
            if REJECT_IMAGE_PATTERN.search(email):
                continue
            if not EMAIL_REGEX.fullmatch(email):
                continue
            valid.add(email)
        return valid


def normalize_url(raw_url: str) -> str:
    url = raw_url.strip()
    if not url:
        return url
    if not re.match(r"^https?://", url, re.IGNORECASE):
        return f"https://{url}"
    return url


def decode_at_dot_obfuscation(text: str) -> str:
    normalized = text
    replacements = {
        r"\s*\[\s*at\s*\]\s*": "@",
        r"\s*\(\s*at\s*\)\s*": "@",
        r"\s+at\s+": "@",
        r"\s*\[\s*dot\s*\]\s*": ".",
        r"\s*\(\s*dot\s*\)\s*": ".",
        r"\s+dot\s+": ".",
        r"\s+AT\s+": "@",
        r"\s+DOT\s+": ".",
    }
    for pattern, repl in replacements.items():
        normalized = re.sub(pattern, repl, normalized, flags=re.IGNORECASE)
    normalized = html.unescape(normalized)
    return normalized


def load_websites(args_websites: list[str]) -> list[str]:
    websites = list(args_websites)
    if INPUT_FILE.exists():
        websites.extend([
            line.strip() for line in INPUT_FILE.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        ])
    # preserve order, dedupe
    seen = set()
    ordered = []
    for site in websites:
        if site not in seen:
            seen.add(site)
            ordered.append(site)
    return ordered


def run_with_timeout(scraper: EmailScraper, website: str, timeout: int) -> SiteResult:
    box: dict[str, SiteResult] = {}
    err: dict[str, Exception] = {}

    def worker() -> None:
        try:
            box["result"] = scraper.process_website(website)
        except Exception as exc:
            err["exc"] = exc

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    thread.join(timeout=timeout)

    domain = urlparse(normalize_url(website)).netloc.lower() or website
    if thread.is_alive():
        return SiteResult(domain=domain, emails=[], failed=True, reason="timeout")
    if "exc" in err:
        logging.exception("Site processing failed for %s", website, exc_info=err["exc"])
        return SiteResult(domain=domain, emails=[], failed=True, reason="error")
    return box["result"]


def write_csv(results: list[SiteResult]) -> None:
    with OUTPUT_FILE.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["domain", "emails"])
        for result in results:
            writer.writerow([result.domain, ", ".join(result.emails)])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape emails from websites with resilient queueing.")
    parser.add_argument("websites", nargs="*", help="Websites to process. Also reads input.txt when present.")
    parser.add_argument("--timeout", type=int, default=45, help="Hard timeout per website in seconds.")
    parser.add_argument("--continue", dest="continue_mode", action="store_true", help="Reprocess sites in pending.txt.")
    parser.add_argument("--exclude-emails", default="", help="Comma-separated emails to exclude.")
    parser.add_argument("--exclude-domains", default="", help="Comma-separated domains to exclude.")
    parser.add_argument("--max-pages", type=int, default=5, help="Max secondary pages to visit per domain.")
    parser.add_argument("--workers", type=int, default=6, help="Parallel worker count.")
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(
        filename=ERROR_FILE,
        level=logging.ERROR,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    args = parse_args()
    websites = load_websites(args.websites)
    if not websites:
        print("No websites provided. Pass URLs or create input.txt.")
        return

    pending_queue = PendingQueue(PENDING_FILE)
    previous_pending = pending_queue.snapshot()

    if not args.continue_mode:
        sites_to_process = [w for w in websites if normalize_url(w) not in previous_pending]
    else:
        sites_to_process = websites

    if not sites_to_process:
        print("Nothing to process after pending-queue filtering.")
        return

    scraper = EmailScraper(
        timeout=args.timeout,
        max_pages=max(0, args.max_pages),
        exclude_emails=set(x.strip().lower() for x in args.exclude_emails.split(",") if x.strip()),
        exclude_domains=set(x.strip().lower() for x in args.exclude_domains.split(",") if x.strip()),
    )

    results: list[SiteResult] = []
    failures = 0

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        future_map = {}
        for raw_site in sites_to_process:
            normalized = normalize_url(raw_site)
            pending_queue.add(normalized)
            future = executor.submit(run_with_timeout, scraper, normalized, args.timeout)
            future_map[future] = normalized

        for future in as_completed(future_map):
            site = future_map[future]
            try:
                result = future.result()
            except Exception as exc:
                logging.exception("Unhandled future failure for %s", site, exc_info=exc)
                result = SiteResult(domain=urlparse(site).netloc.lower(), emails=[], failed=True, reason="error")

            if result.failed:
                failures += 1
                print(f"{result.domain} -> FAILED ({result.reason})")
            else:
                pending_queue.remove(site)
                print(f"{result.domain} → {', '.join(result.emails) if result.emails else '(none)'}")
            results.append(result)

    successful_results = [r for r in results if not r.failed]
    write_csv(successful_results)

    total_emails = sum(len(r.emails) for r in successful_results)
    print("\nSummary")
    print(f"Total sites processed: {len(results)}")
    print(f"Total emails found: {total_emails}")
    print(f"Sites failed/timed out: {failures}")


if __name__ == "__main__":
    main()
