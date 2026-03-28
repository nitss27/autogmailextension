# Bulk Email Extractor (Chrome Extension)

Manifest V3 extension for sequential, active-tab email extraction.

## Workflow

For each URL (one-by-one, preserving the same order as entered):

1. Open a new tab with `active: true`.
2. Wait for `tabs.onUpdated` status `complete`.
3. Extract emails from `document.documentElement.innerHTML` + `mailto:` links.
4. Discover `contact` / `about` links.
5. Navigate the **same tab** to those secondary pages and extract more emails.
6. Also fetch raw page source for main + secondary pages for source-level emails (secondary source fetches run in parallel for speed).
7. Deduplicate emails per domain.
8. If strict timeout is exceeded for a website, that website is skipped.
9. Close the tab and move to the next URL.

The popup shows live progress (`Processing X of Y...`) and stores run state/results in extension storage, so reopening the popup still shows output for copying.

## Controls

- **Start**: resumes paused run from persistent storage, or starts a new run when no paused run exists.
- **Stop**: forcefully halts the current run immediately.
- **Skip Current**: instantly skips the current website and moves on.
- **Clear List**: clears input and persisted run state.
- **Copy Table**: copies a 2-column table (`Website | Emails`) with comma-separated emails.

You can also use the **Exclude emails** box (one rule per line). This list is saved and automatically applied in future runs.

You can set:
- **Tab load timeout (ms)** (saved, default fallback `15000ms`)
- **Strict skip timeout per website (seconds)** (saved, default `10s`)

Rules:
- `person@example.com` excludes that exact email.
- `@example.com` excludes all emails from that domain and its subdomains.

## Load extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`autogmailextension`)

## Notes

If a site contains the message `Verify your are human by completing the action below` and no emails are found, that site is skipped with: `Skipped due to robot verification message. Verify first human.`
