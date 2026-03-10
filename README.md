# AI Form Auto Filler (Chrome Extension)

This extension automates a full workflow for job/application forms:

1. You paste one or many form links.
2. Extension opens each form and captures required fields + page source.
3. Extension switches to your already-open ChatGPT conversation tab and submits a prompt automatically.
4. It waits for ChatGPT response, extracts `xpath\tvalue` mappings.
5. It returns to the form tab and fills fields automatically (optionally submits form).

## How to use

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Open extension popup.
5. Open your target ChatGPT conversation tab first, then keep/set the same URL in popup.
6. Paste form URLs (one per line).
7. (Optional) enable **Auto submit after filling**.
8. Click **Run Full Automation**.

## ChatGPT response format expected

Best output is TSV:

```text
xpath\tvalue
//*[@id="firstName"]\tJohn
//*[@id="lastName"]\tDoe
```

The extension also tries to parse table responses where first column is XPath and second column is value.

## Notes

- Required fields are detected with `required` / `aria-required="true"`.
- For `<select>`, available options are included in prompt to improve matching.
- Only compact field metadata (xpath/name/label/options) is sent to ChatGPT; full page HTML is not sent.
- The extension can parse TSV from code blocks, markdown tables, or plain text response lines.
- Some forms include captcha/OTP/manual checks that cannot be bypassed automatically.

- ChatGPT tab must already be open; this extension will not create a new ChatGPT tab automatically.

## On-page manual buttons

- Every page now shows a small **AI Form Helper** panel in the bottom-right corner.
- Use **1) Capture + Ask ChatGPT** to send required field metadata from current form page.
- Use **2) Fill From ChatGPT Output** to read latest ChatGPT TSV output and fill the current page.
- On ChatGPT pages, these buttons are shown but disabled.
