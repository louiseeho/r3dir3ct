# r3dir3ct

`r3dir3ct` is a Chrome extension that blocks distracting websites and redirects you toward productive work, primarily by sending you to LeetCode problems (or a custom URL target).

## What It Does

- Blocks sites using a configurable list (blacklist or whitelist mode).
- Redirects blocked visits to:
  - a LeetCode problem, or
  - a custom URL you choose.
- Tracks behavior stats such as daily redirects, streak, and recent activity.
- Shows a heatmap view in the popup for behavior patterns.
- Supports LeetCode username syncing to track solved problems and reduce repeat problem assignment.
- Adds a "shame overlay" message on LeetCode problem pages to reinforce focus.
- Supports delayed/pending site removal with a "solve-first" style gate.

## Tech Stack / Extension Model

- **Manifest**: Chrome Extension Manifest V3 (`manifest.json`)
- **Background worker**: `background.js` (core redirect + rule logic)
- **Popup UI**: `popup.html` + `popup.js`
- **Content script**: `shame-overlay.js` (runs on LeetCode problem pages)
- **Storage**:
  - `chrome.storage.sync` for user settings
  - `chrome.storage.local` for local behavioral state

## Project Structure

- `manifest.json` - extension metadata, permissions, entry points
- `background.js` - blocking/redirect orchestration, alarms, rule matching
- `popup.html` / `popup.js` - dashboard and controls
- `redirect-settings.js` - redirect mode + site-list mode parsing/helpers
- `schedule.js` - problem scheduling/selection behavior
- `behavior.js` - redirect/solve logging and behavior aggregation
- `heatmap.js` - popup heatmap rendering
- `leetcode-sync.js` / `graphql.js` - LeetCode solved-state syncing
- `shame-overlay.js` / `messages.js` - in-page motivational overlays
- `problems.js` - problem catalog used for redirects

## Install Locally (Developer Mode)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project folder (`r3dir3ct`).
5. Pin the extension and open its popup to configure your settings.

## Basic Usage

1. Add sites you want to control.
2. Pick your site-list mode (blacklist/whitelist).
3. Pick your redirect mode (LeetCode/custom URL).
4. Turn the extension on.
5. Visit a blocked site and confirm you are redirected.

## Notes

- The extension requests broad host access (`<all_urls>`) so it can evaluate and redirect across sites.
- LeetCode integration depends on LeetCode page/API availability and your configured username.