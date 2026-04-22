# Gemini Image Edit Batch Processor (Chrome Extension)

This extension automates batch image-editing flows in Gemini:

1. Clicks the plus upload button (`aria-label="Open upload file menu"`).
2. Clicks **Upload files** (`data-test-id="local-images-files-uploader-button"`).
3. Injects one image file.
4. Types the matching prompt.
5. Sends and waits for Gemini to finish.
6. Repeats for all images.

It also includes an optional **Download Outputs by Prompt Match** action modeled on your reference script.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.

## Use

1. Open `https://gemini.google.com/` and log in.
2. Open extension popup.
3. Select images and enter prompts (one per line).
4. Enter prompts with one prompt per line (use exactly one prompt for each image, or one prompt total to reuse for all).
5. Click **Run Batch Edit** (it now auto-downloads matched generated images after all edits complete).

If only one prompt is provided, it is reused for every image.


## Stability notes

The content script targets stable attributes first (e.g. `aria-label`, `data-test-id`) and avoids relying on changing Angular class hashes. This makes the flow resilient across Gemini refreshes. If Gemini hides native file inputs, the extension also falls back to dropzone-based upload events.
