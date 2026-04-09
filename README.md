# Email Scraper CLI

Production-ready Python CLI for scraping emails from website lists with a persistent file-backed pending queue.

## Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

```bash
python app.py [websites ...] [--timeout 45] [--continue] [--exclude-emails a@b.com,c@d.com] [--exclude-domains foo.com,bar.com] [--max-pages 5]
```

Input websites can be supplied via positional arguments and/or `input.txt` (one URL per line).

## Queueing behavior (`pending.txt`)

- Every website is written to `pending.txt` before processing begins.
- On success, the site is removed from `pending.txt`.
- On failure/timeout, it stays in `pending.txt`.
- Next run skips pending sites by default.
- Use `--continue` to reprocess those pending sites.

## Output

- Console line per domain:
  - `domain.com → email1@domain.com, email2@domain.com`
- CSV file: `output.csv` with columns `domain, emails`
- Error log: `errors.log`
- Summary printed at end:
  - total sites processed
  - total emails found
  - sites failed/timed out
