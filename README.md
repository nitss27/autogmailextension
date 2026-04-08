# Bulk Email Harvester (Python Dashboard)

Run locally:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
python app.py
```

Open `http://127.0.0.1:5000`.

## Features

- Bulk URL input and normalization
- Exclusion rules (`email`, `@domain`, `@.tld`, keyword)
- Start / Continue / Stop / Force Stop / Skip / Reset
- Per-URL hard timeout and retry-on-fail
- Dynamic rendering with Playwright Chromium in **non-headless** mode (when available)
- Multi-strategy extraction: HTML, text, mailto, JSON-LD, meta, microdata, data attributes, obfuscation decode
- Secondary-page discovery (contact/about/support/help/team/staff/reach-us)
- Confidence scoring and capped output (20 per domain)
- Live dashboard status and copy exports
