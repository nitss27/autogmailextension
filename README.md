# LinkedIn Company Extractor (Chrome Extension)

This extension collects company URLs from LinkedIn Jobs, then opens each company profile About page and extracts fields into a table.

## Workflow

1. Open LinkedIn Jobs search results.
2. Enter **Number of listings to fetch** in popup.
3. Click **Fetch All Companies**:
   - scrolls the job list to the end of current page,
   - clicks job cards to gather company URLs,
   - clicks **Next** page button and repeats,
   - stops once target listing count is reached (or no next page).
4. Click **Process Company Profiles**:
   - opens each company `/about/` page in a background tab,
   - extracts company fields,
   - closes tab and moves to next company.
5. Review table and use **Copy Table (TSV)**.

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

## Notes

- You must be logged in to LinkedIn.
- LinkedIn UI changes can require selector updates.
- Some rows may return `error` status due to access limits or missing data.
