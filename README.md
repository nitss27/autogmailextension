# Domain Email Harvester (Chrome Extension)

This extension processes a list of websites and returns a table of:

- Domain
- Emails found in the main page source HTML
- Emails found in contact pages (URLs that include `contact`)
- Contact URL count
- Any processing error

The resulting table is automatically copied to the clipboard (TSV format) and can be pasted into Google Sheets/Excel.

## Load extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`autogmailextension`)

## Use

1. Click the extension icon.
2. Paste one domain or URL per line.
3. Click **Process Websites**.
4. Paste clipboard content where needed.
