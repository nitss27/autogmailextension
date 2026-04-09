# Email Scraper Web App

A Flask-based web dashboard that lets you upload website lists and scrape emails end-to-end from the browser UI.

## Features

- Upload `.txt` input files and/or paste websites.
- Persistent queue file (`pending.txt`) with resume behavior.
- `--continue` equivalent toggle in UI to retry pending sites.
- Per-site timeout, max pages, workers, exclusions.
- Each website/page can be opened in a **headed browser** (Playwright, non-headless) while scraping.
- Output to `output.csv`, failures logged to `errors.log`.

## Run

```bash
pip install -r requirements.txt
python app.py
```

Open `http://127.0.0.1:5000`.

## Queue behavior

- Site is added to `pending.txt` before processing.
- On success, it is removed.
- On timeout/error, it remains.
- Next run skips pending sites unless **Continue pending** is enabled.
