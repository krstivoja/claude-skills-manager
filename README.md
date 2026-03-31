# Claude Skills Manager

Chrome extension that syncs your local Claude Code skills to Claude.ai with one click. No server, no manual uploading each skill one by one.

## The Problem

When you update skills locally in `~/.claude/skills/`, you have to manually upload each one to Claude.ai through the web UI. With 10, 20, or 50+ skills, this gets tedious fast.

## The Solution

1. Click the extension icon
2. Select your skills folder
3. Click **Sync All** — every skill gets zipped and uploaded automatically

## Install

1. Clone this repo
   ```
   git clone https://github.com/flavor-dev/claude-skills-manager.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `extension` folder from the cloned repo

## Usage

1. Click the extension icon in your Chrome toolbar
2. Click **Select Folder** and pick your skills directory (e.g. `~/.claude/skills`)
3. The extension scans and lists all skill folders containing a `SKILL.md`
4. Click **Sync All to Claude.ai** to upload everything

Re-run anytime you update your skills. The extension reads the folder fresh each time.

You don't need to have Claude.ai open — the extension automatically finds or opens the skills page.

## Skill Folder Structure

The extension looks for folders containing a `SKILL.md` file:

```
~/.claude/skills/
  my-skill/
    SKILL.md
  another-skill/
    SKILL.md
    references/
      guide.md
  wp-plugin-dev/
    SKILL.md
    examples/
      hooks.php
```

- Each skill folder is zipped as Claude.ai expects
- All files in the folder are included recursively
- Hidden files/folders (starting with `.`) are excluded

## How It Works

1. **Popup** scans the selected folder for skills (folders with `SKILL.md`)
2. Each skill is zipped in-memory using JSZip
3. The ZIP is sent to the **background service worker**
4. The service worker finds or opens the Claude.ai skills page
5. A **content script** is injected that sets the file on the upload input and triggers React's change handlers

Everything runs client-side. No data leaves your browser except the normal upload to Claude.ai.

## Requirements

- Chrome 86+ (uses the File System Access API)
- A Claude.ai account with skills enabled

## Troubleshooting

**All uploads fail**
Open the Claude.ai skills page manually (`claude.ai/customize/skills`) and check if the UI has changed. The extension relies on finding a file input element on that page.

**Folder picker doesn't appear**
The File System Access API is Chrome-only. Firefox and Safari are not supported.

**"No file input found after clicking upload button"**
Claude.ai may have updated their UI. The extension searches for upload buttons by text content and aria-labels. If these change, the selectors in `background.js` need updating.

## Tech Stack

- Chrome Extension Manifest V3
- File System Access API
- JSZip (bundled)
- No frameworks, no build step

## License

MIT

---

Built by Marko Krstić &middot; [flavor.dev](https://flavor.dev)
