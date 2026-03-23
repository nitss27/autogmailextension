# LinkedIn Company Extractor (Chrome Extension)

Extracts **job listing details + company profile details** from LinkedIn jobs pages.

## What it captures

### From each job listing
- Job title
- Job URL
- Company name from listing
- Company profile URL
- Location/meta line
- Posted time (when available)
- Applicants text (when available)
- Work type (On-site/Remote/Hybrid when available)
- Employment type (Full-time/Contract/etc when available)
- Easy Apply flag

### From each company profile About page
- Website
- Industry
- Company size
- Headquarters
- Specialties
- Verified page date

## Workflow

1. Open LinkedIn job results page.
2. Enter listing count target in popup.
3. Click **Fetch Listings**:
   - scrolls to end of current list,
   - clicks each listing,
   - captures listing details + company profile link,
   - clicks Next and continues until target is met.
4. Click **Process Company Profiles** to enrich rows with company About data.
5. Use **Copy Table (TSV)** for export.

## Persistence

- The extension saves fetched links/results in `chrome.storage.local`.
- Closing/reopening the extension keeps previously fetched table data until you click **Clear**.
