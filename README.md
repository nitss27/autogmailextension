# Bulk Email Extractor (Chrome Extension)

Manifest V3 extension for sequential, active-tab email extraction.

## Workflow

For each URL (one-by-one):

1. Open a new tab with `active: true`.
2. Wait for `tabs.onUpdated` status `complete` (uses configurable **Tab load timeout (ms)**).
3. Extract emails from `document.documentElement.innerHTML` + `mailto:` links.
4. Discover `contact` / `about` links.
5. Navigate the **same tab** to those secondary pages and extract more emails.
6. Fetch raw page source for main + secondary pages for source-level emails.
7. Deduplicate and apply exclude rules.
8. If **Strict skip timeout per website** is exceeded, skip that website.
9. Close the tab and move to the next URL.

## Controls

- **Start**: resumes the most recent paused run from saved storage; otherwise starts a new run from the current list.
- **Stop**: immediately pauses processing.
- **Skip Current**: immediately skips the active website and continues.
- **Clear List**: clears the website input box.
- **Copy Table**: copies TSV/HTML table with columns (`Domain`, `Emails`, `Error`), and emails comma-separated in one cell.

The popup stores state/results in extension storage, so reopening still shows progress/results.
Live results keep updating while the run is active, and previously collected rows remain visible after popup reopen.
Copy uses both plain-text TSV and HTML table formats for better Excel/Sheets cell alignment.

## Notes

If a site contains `Verify your are human by completing the action below` and no emails are found, that site is marked with:
`Skipped due to robot verification message. Verify first human.`

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
4. Set **Tab load timeout (ms)** and **Strict skip timeout per website**.
5. Click **Start** (it resumes paused progress if available).
6. Use **Stop** / **Skip Current** when needed.
7. Click **Copy Table** after/during completion.
