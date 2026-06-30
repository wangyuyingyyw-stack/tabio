# Tabio

A smart Chrome extension for tab management — automatically deduplicates tabs, cleans up inactive ones, and lets you find any open tab instantly from the address bar.

## Features

- **Auto Deduplicate** — When you open a URL that's already open, the old duplicate is automatically closed, keeping your new tab active.
- **Inactive Tab Cleanup** — Tabs you haven't visited for a configurable time (default 30 min) are auto-closed and saved to history for easy recovery.
- **Address Bar Search** — Type `go` + Tab in Chrome's address bar, then search across all open tabs in all windows. Select a result to jump directly to that tab.
- **Quick Overview** — Popup dashboard shows total tabs, duplicate count, and nearly-expired tabs at a glance.
- **One-Click Cleanup** — Manually close all duplicates or all timed-out tabs with a single button.
- **Smart Protection** — Pinned tabs, tabs playing audio, and whitelisted URLs are never auto-closed.
- **Duplicate Tab Detection** — If you intentionally duplicate a tab (right-click → Duplicate), Tabio respects that and won't close it.
- **Closed Tab History** — All auto-closed tabs are saved with one-click restore.

## Install

### From Chrome Web Store

> Coming soon

### Load Unpacked (Developer Mode)

1. Clone this repo or download the ZIP
2. Open `chrome://extensions/` in Chrome
3. Enable "Developer mode" (top-right toggle)
4. Click "Load unpacked" and select the project folder
5. Tabio icon appears in your toolbar

## Usage

### Address Bar Search

1. Click the address bar (or press `Cmd+L` / `Ctrl+L`)
2. Type `go` then press **Tab**
3. Type any keyword (page title or URL)
4. Select from suggestions and press Enter to jump to that tab

### Popup Panel

Click the Tabio icon in the toolbar to access:

- **Overview** — Stats + one-click cleanup buttons
- **Search** — Search and jump to any open tab
- **History** — View and restore auto-closed tabs
- **Settings** — Configure timeout, protection rules, whitelist

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Auto Deduplicate | On | Close old tab when duplicate URL is opened |
| Dedupe Scope | All windows | Check across all windows or current only |
| Auto Close Inactive | On | Close tabs after inactivity timeout |
| Inactive Timeout | 30 min | Time before a tab is considered inactive |
| Protect Pinned | On | Never auto-close pinned tabs |
| Protect Audible | On | Never auto-close tabs playing audio |
| Whitelist | Empty | URL patterns to exclude (supports `*` wildcard) |

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks, no build step)
- Chrome APIs: `tabs`, `storage`, `alarms`, `omnibox`

## License

MIT
