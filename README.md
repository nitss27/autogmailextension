# Domain Email Harvester (Chrome Extension)

This extension processes many websites and outputs a per-domain email table.

## What it does

For each website you provide:

1. Opens the site in a tab (in batches, e.g. 5 at a time).
2. Extracts emails from rendered DOM + HTML.
3. Fetches source HTML and extracts emails there too.
4. Finds contact links (`href` includes `contact`) and fetches those pages for more emails.
5. Closes processed tabs and moves to the next batch automatically.
6. Copies a TSV table to clipboard: Domain, Emails, Contact URLs Found, Error.

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
5. Paste clipboard content into Sheets/Excel.
