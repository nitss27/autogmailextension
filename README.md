# Domain Email Harvester (Chrome Extension)

This extension processes many websites and outputs a per-domain email table.

## What it does

For each website you provide:

1. Opens all sites in a batch first (e.g. 5 tabs), visits/extracts each tab automatically, then closes them.
2. Extracts emails from rendered DOM/page content.
3. Opens `view-source:` for the home page and extracts source emails.
4. Finds contact links (`href` includes `contact`).
5. Opens/fetches contact pages and also opens their `view-source:` pages.
6. Exports **Rendered Emails**, **Source Emails**, and **All Emails** (merged/deduped).
7. Runs fully automatic until all batches are complete.

## Load extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`autogmailextension`)

## Use

1. Click extension icon.
2. Paste one URL/domain per line.
3. Set **Max websites opened at a time** (default: 5).
4. Click **Process Websites**.
5. The final TSV table is copied to clipboard automatically.
