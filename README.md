# Bulk Email Extractor (Chrome Extension)

Manifest V3 extension for sequential, active-tab email extraction.

## Workflow

For each URL (one-by-one):

1. Open a new tab with `active: true`.
2. Wait for `tabs.onUpdated` status `complete`.
3. Extract emails from `document.documentElement.innerHTML` + `mailto:` links.
4. Discover `contact` / `about` links.
5. Navigate the **same tab** to those secondary pages and extract more emails.
6. Fetch raw page source for main + secondary pages for source-level emails.
7. Deduplicate and apply exclude rules.
8. Close the tab and move to the next URL.

## Controls

- **Start / Resume**: starts a new run, or resumes from last paused index.
- **Stop**: immediately pauses processing.
- **Skip Current**: immediately skips the active website and continues.
- **Strict timeout per website**: default `10` seconds; when exceeded, the site is skipped with timeout error.

The popup stores state/results in extension storage, so reopening still shows progress/results.
Copy uses both plain-text TSV and HTML table formats for better Excel/Sheets cell alignment.

You can use **Exclude emails** rules (saved automatically):
- `person@example.com` excludes that exact email.
- `@example.com` excludes all emails from that domain and its subdomains.

## Load extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`autogmailextension`)

## Use

1. Click extension icon.
2. Paste one URL/domain per line.
3. (Optional) Fill exclusion rules.
4. Set strict timeout seconds.
5. Click **Start / Resume**.
6. Use **Stop** or **Skip Current** when needed.
7. Click **Copy Table** after/during completion.
