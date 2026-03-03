# Gmail Auto Sender (Chrome Extension)

A Manifest V3 extension that automates Gmail compose and sends emails **one-by-one**.

## Features

- Manual Gmail flow automation: **Compose → To → Subject → Body → Attach → Send**.
- Faster send loop while keeping the same sequence, using short dynamic waits and not blocking long on previous delivery completion.
- Batch sending, one recipient at a time, with a strict single-compose lock to prevent overlapping sends.
- Input modes:
  - Single email form.
  - Pasted CSV/TSV rows with headers: `to,subject,body[,sent,attach]`.
  - Google Sheet URL (public CSV export, **no OAuth**).
- Rich body formatting support:
  - raw HTML from sheet/body is preserved if provided,
  - plus `**bold**`, `__underline__`, and `- bullet items` for plain text,
  - preserves multi-line body text from quoted CSV cells (line breaks kept).
- Attachment options:
  - global toggle to send without attachment,
  - in sheet mode, optional row-level attachment rule from `attach` column (`yes/true/1`).
- Sheet status handling:
  - only uses sheet `sent` column to determine unsent rows,
  - after successful send, tries to write `YES` back to sheet `sent` column.
- Persistent saved settings:
  - last mode,
  - Google Sheet URL,
  - send limit per run,
  - attachment toggles.

## How to use

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and pick this folder.
4. Open Gmail in a tab and sign in.
5. Open extension popup and choose input mode.
6. Set attachment toggle/rule as needed, and choose file only if required.
7. Click **Send One-by-One**.

## Google Sheet mode (no OAuth)

- Required columns: `to,subject,body,sent`
- Optional attachment rule column: `attach`
  - `yes/true/1` => attachment sent for that row (when global attachment toggle is ON)
  - blank/other => send without attachment for that row
- Ensure the sheet is accessible as CSV export (public/published as needed).
- Paste the Google Sheet URL in popup once; it is saved.

### If you see "Failed to fetch"

- Ensure the sheet is shared/published so CSV export is accessible.
- Keep a `gid` in the URL when targeting a specific tab.
- The extension tries multiple CSV endpoints (`/export?format=csv` and `gviz/tq?tqx=out:csv`) automatically.

## Notes

- Gmail may block risky attachment types for security.
- Use safer file types like PDF/DOC/DOCX/TXT for resumes.
