# Bulk Email Harvester (Web UI + Hard Timeout Worker)

This app provides a browser UI for scraping emails from websites while enforcing a strict per-site hard timeout.

## Run

```bash
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

## Key behavior

- Hard timeout is enforced with `threading.Timer` per URL.
- On timeout/skip/stop, the current browser page is force-closed.
- Timed-out domains are persisted in `skip_domains.txt` and auto-skipped next run.
- Successful domains are removed from `skip_domains.txt`.
- Secondary contact/about/support pages are discovered and scraped (`max_pages` from UI).
- UI supports direct paste + `.txt` upload.
