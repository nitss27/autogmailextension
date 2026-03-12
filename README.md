# LinkedIn Company Extractor (Chrome Extension)

A Manifest V3 extension that helps you:

1. Collect company profile URLs from LinkedIn Jobs listings/cards.
2. Process each company profile (About page) to extract business information.
3. View all extracted output in the popup and copy everything in one click.

## Features

- Fetches company links from current LinkedIn jobs page cards.
- Attempts to click visible job cards first, then reads company anchors.
- Processes each company URL and loads `/about/` data.
- Extracts fields such as:
  - Website
  - Industry
  - Company size
  - Headquarters
  - Specialties
  - Verified page date (when available)
- Shows results in popup JSON output box.
- Includes **Copy All** button.

## How to use

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open a LinkedIn Jobs page where job cards are visible.
5. Open extension popup and click **Fetch Company URLs**.
6. Click **Process Company Profiles**.
7. Review results in output box and click **Copy All** if needed.

## Notes

- You must be logged in to LinkedIn in the browser profile where extension runs.
- If LinkedIn limits or blocks requests, some profiles may return errors; these are included in output.
- Selectors are designed to be resilient, but LinkedIn UI changes may require updates.
