# Gmail Auto Sender (Chrome Extension)

A Manifest V3 extension that automates Gmail compose and sends emails **one-by-one**.

## Features

- Manual Gmail flow automation: **Compose → To → Subject → Body → Attach → Send**.
- Faster send loop while keeping the same sequence, using dynamic waits instead of long fixed delays.
- Batch sending, one recipient at a time.
- Input modes:
  - Single email form.
  - Pasted CSV/TSV rows with headers: `to,subject,body[,sent]`.
  - Google Sheet URL (public CSV export, **no OAuth**).
- Rich body formatting from input/sheet:
  - `**bold**`
  - `__underline__`
  - `- bullet items`
- Attachment upload as a real file per email.
- Continue from unsent entries:
  - skips rows with `sent=yes/true/sent/1/done`
  - in sheet mode tracks sent rows in local extension storage (`sheetSentRowsByUrl`).
- Sheet sent-status writeback:
  - if your sheet has a `sent` column, extension attempts to write `YES` for successfully sent rows.
  - if writeback fails, local sent tracking still prevents re-sending the same rows.
- Persistent saved settings:
  - last mode
  - Google Sheet URL
  - send limit per run

## How to use

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open Gmail in a tab and sign in.
5. Open extension popup and choose input mode.
6. Add/select attachment.
7. Click **Send One-by-One**.

## Google Sheet mode (no OAuth)

- Put columns in first row: `to,subject,body` and add `sent` column if you want sheet writeback.
- Ensure the sheet is accessible as CSV export (public/published as needed).
- Paste the Google Sheet URL in popup once; it is saved.

### If you see "Failed to fetch"

- Ensure the sheet is shared/published so CSV export is accessible.
- Keep a `gid` in the URL when targeting a specific tab.
- The extension now tries multiple CSV endpoints (`/export?format=csv` and `gviz/tq?tqx=out:csv`) automatically.

## Notes

- Gmail may block risky attachment types for security.
- Use safer file types like PDF/DOC/DOCX/TXT for resumes.
