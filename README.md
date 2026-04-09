# Bulk Email Harvester

A Python/Flask web app that scrapes emails from multiple domains using 10+ extraction strategies.

## Quick Start

### macOS / Linux
```bash
bash run.sh
```

### Windows
Double-click `run.bat`

Then open: **http://127.0.0.1:5000**

---

## Features

### Extraction Strategies (all run per domain)
1. **mailto: href** — dedicated regex for `<a href="mailto:...">` (HIGH confidence)
2. **Raw HTML scan** — regex across full server-returned HTML
3. **JSON-LD structured data** — parses `<script type="application/ld+json">`
4. **Meta tag content** — scans all `<meta content="...">` values
5. **Schema.org microdata** — `[itemprop="email"]` elements
6. **data-* attributes** — `data-email`, `data-contact`, `data-mail`
7. **Visible body text** — `soup.get_text()` with AT/DOT decoding
8. **HTML entity decoding** — `&#64;` → `@`
9. **Obfuscation decoding** — `[at]`, `(at)`, `AT`, `[dot]`, base64, ROT13, reversed strings
10. **Secondary page discovery** — visits contact/about/team/support pages (configurable limit)

### Reliability
- Hard per-URL timeout (default 45s, configurable) — never hangs the queue
- Skip current URL button
- Stop / Force Stop / Continue (resume from where stopped)
- HTTPS → HTTP fallback, www. prefix fallback
- All errors caught and logged per domain

### Email Cleaning
- Rejects placeholder emails (noreply, example@, test@, etc.)
- Rejects file-extension false positives (.png, .jpg, .css, .js, etc.)
- Rejects file-path-like patterns
- Deduplication with confidence-based priority
- Per-domain cap (default 20 emails)
- Exclusion rules: exact email, domain wildcard, keyword

### Dashboard
- Dark industrial UI (DM Sans + JetBrains Mono)
- Live row-by-row results as each domain finishes
- Confidence badges: HIGH (green) / MEDIUM (amber) / LOW (gray)
- Copy as TSV table or plain email list
- Progress bar + status indicator

---

## Manual Install (without run.sh)

```bash
pip install flask requests beautifulsoup4 lxml
python app.py
```

---

## Exclusion Rule Syntax

Paste rules in the "Exclude Rules" box:

```
# Lines starting with # are ignored
noreply@example.com        # exact email
@example.com               # entire domain + subdomains
noreply                    # keyword in local part
@.png                      # reject any email with .png TLD
```
