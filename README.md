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
8. Close the tab and move to the next URL.

The popup shows live progress (`Processing X of Y...`) and stores run state/results in extension storage, so reopening the popup still shows output for copying. You can now choose **Start New**, **Continue Left** (resume unprocessed websites), **Stop** (pause after current website), or **Clear List**. It exports a copyable TSV table (`Domain | Emails | Error`).

You can also use the **Exclude emails** box (one rule per line). This list is saved and automatically applied in future runs.

You can set **Tab load timeout (ms)** manually in the popup. This setting is saved; if the box is cleared, the extension falls back to the default timeout (`15000ms`).
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
3. (Optional) Fill **Exclude emails** with addresses to filter out.
4. Click **Start**.
5. Wait for completion, then click **Copy Table** (or use auto-copied output).

## Notes

If a site contains the message `Verify your are human by completing the action below` and no emails are found, that site is skipped with error: `Skipped due to robot verification message. Verify first human.`
