# Resume Assistant Pro (Chrome Extension)

This project is now packaged as a **Chrome Extension** with a dedicated assistant tab.

## What was converted

- Converted to a tab-based Chrome Extension workflow.
- Clicking the extension icon opens `assistant.html` (full-page UI).
- Omnibox keyword `ra` is available from Chrome address bar.
- Fill actions are sent to the currently tracked job-form tab via `chrome.scripting`.
- Add, edit, and delete resume items directly in the assistant tab (saved to extension local storage).
- Import multiple items from CSV (`label,value,category,tags`) in one click.

## Keyboard features (inside assistant tab)

- `ArrowLeft` / `ArrowRight` → toggle categories in order:
  - `All`, `Personal`, `Contact`, `Address`, `Skills`, `Experience`, `Education`, `Interests`
- `ArrowUp` / `ArrowDown` → move selection in results
- `Enter` → copy selected value
- `Shift+Enter` → fill selected value in target job-form tab
- `Alt+Q` → focus search box
- `Alt+N` → focus add/edit item form

## Install as Chrome Extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.
5. Click the extension icon to open Resume Assistant tab.

## Core files used by the extension

- `manifest.json`
- `background.js`
- `assistant.html`
- `assistant.css`
- `assistant.js`
