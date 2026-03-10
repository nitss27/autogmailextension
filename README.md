# Form Capture + ChatGPT Autofill (Chrome Extension)

This extension automates your workflow:

1. Capture current page source + required form fields.
2. Open/focus your ChatGPT conversation tab.
3. Paste and send a generated prompt to ChatGPT.
4. Paste ChatGPT TSV output back into the popup.
5. Fill the original form fields using XPath mappings.

## How to use

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the target form page in a tab.
5. Open extension popup.
6. Keep ChatGPT URL as default (or change it).
7. Click **Capture + Send to ChatGPT**.
8. In ChatGPT response, copy TSV rows in format:

   ```
   xpath\tvalue
   //*[@id="firstName"]\tJohn
   //*[@id="lastName"]\tDoe
   ```

9. Go back to form tab, paste TSV in popup, click **Fill Current Form Tab**.

## Notes

- The extension captures only up to `Max HTML chars` (default 120000).
- Required fields are detected using `required` / `aria-required="true"`.
- XPath-first fill strategy is used. If a field is not found, it is skipped.
- You can adjust ChatGPT prompt behavior inside `content.js` (`buildPrompt` function).
