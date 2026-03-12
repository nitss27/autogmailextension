# LinkedIn Company Extractor (Chrome Extension)

This Chrome Extension helps you collect companies from LinkedIn Jobs and then extract each company profile's About information.

## Workflow

1. Open LinkedIn Jobs search results.
2. Click **Fetch All Companies** in the extension popup.
   - The extension clicks through the visible job cards in the list.
   - It keeps scrolling the list to load more cards and collects unique company URLs.
3. Click **Process Company Profiles**.
   - The extension opens each company About page (`/company/<slug>/about/`) in a new background tab.
   - It extracts details and closes the tab automatically.
4. Review results in the popup table.
5. Click **Copy Table (TSV)** to copy all rows.

## Extracted fields

- Company
- LinkedIn URL
- Website
- Industry
- Company Size
- Headquarters
- Specialties
- Verified Page
- Status

## Setup

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this project folder.
4. Open LinkedIn Jobs and run the extension.

## Notes

- You must be logged in to LinkedIn in that Chrome profile.
- LinkedIn UI changes can require selector updates.
- Some rows can return `error` status when data is unavailable or access is restricted.
