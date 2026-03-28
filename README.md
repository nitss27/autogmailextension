# Bulk Email Extractor (Chrome Extension)

Manifest V3 extension for sequential, active-tab email extraction with pause-resume persistence.

## Workflow

For each URL (one-by-one, preserving the same order as entered):

1. Open a new tab with `active: true`.
2. Wait for `tabs.onUpdated` status `complete`.
3. Extract emails from `document.documentElement.innerHTML` + `mailto:` links.
4. Discover `contact` / `about` links.
5. Navigate the **same tab** to those secondary pages and extract more emails.
6. Fetch raw page source for main + secondary pages for source-level emails.
7. Deduplicate emails per website and append output immediately to the popup table.
8. Close the tab and move to the next URL.

## Controls

- **Start**: Starts a new run or resumes from the latest paused state saved in `chrome.storage.local`.
- **Stop**: Immediate, forceful halt (current tab closes immediately and run pauses at current index).
- **Skip**: Immediate skip of current website and continue to the next website.
- **Strict timeout (seconds)**: Defaults to `10`. If a website exceeds this value it is automatically skipped.

The results table is always two columns only: **Website** and **Emails** (emails are comma-separated in one cell). Results persist when the popup closes.

## Data behavior

- Completed websites are not processed again on resume.
- Website list, timeout value, exclude rules, and run state are persisted locally.
- Output rows are continuously appended in real-time without clearing prior rows.

## Load extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`autogmailextension`)
