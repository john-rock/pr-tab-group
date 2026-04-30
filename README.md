# Pull Requests

Chrome extension that keeps your active GitHub pull requests in a dedicated tab group.

It auto-syncs open PRs where you are:
- the author, or
- a requested reviewer

The extension checks every 15 minutes and can also be synced on demand from the popup.

## Features

- Auto-opens and groups matching PR tabs
- Reuses already-open PR tabs instead of duplicating
- Removes grouped tabs when PRs are no longer open
- One-click manual sync from popup
- Enable/disable grouping without removing your token
- Sync status with last run time and error reporting
- Warns when GitHub SSO org authorization is required

## Install (Developer Mode)

1. Clone this repo.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.

The extension should appear as **Pull Requests**.

## First-Time Setup

1. Click the extension icon.
2. Open **Settings** in the popup.
3. Paste a GitHub personal access token.
4. Click **Save & Sync**.

After validation, the extension immediately runs a sync and starts a recurring 15-minute alarm.

## GitHub Token Requirements

The extension calls:
- `GET /user` (token validation)
- `GET /search/issues` (find open PRs for author/reviewer queries)

Token guidance:
- **Classic PAT**: include `repo` scope if you need private repos.
- **Fine-grained PAT**: grant access to repos you want included.
- If your org uses SSO, authorize the token for that org or private repos may be skipped.

Token is stored in `chrome.storage.local` (not sync storage).

## How It Works

- Background service worker (`background.js`) manages:
  - PR discovery via GitHub API
  - tab opening/reuse
  - group creation and cleanup
  - periodic sync alarm
- Popup (`popup.html` + `popup.js`) handles:
  - enable toggle
  - token management
  - sync-now action
  - queue display and status messages

## Permissions

From `manifest.json`:
- `tabs`, `tabGroups`: manage PR tabs and grouping
- `storage`: persist token/state/settings
- `alarms`: periodic sync
- Host permissions:
  - `https://github.com/*`
  - `https://api.github.com/*`

## Local Development

No build step is required. This is a plain Manifest V3 extension.

When you edit files:
1. Save changes.
2. Go to `chrome://extensions`.
3. Click **Reload** on **PR Review Queue**.

## Troubleshooting

- **No PRs appear**
  - Verify token is valid and saved.
  - Ensure there are open PRs where you are author or requested reviewer.
  - Click **Sync now**.
- **Private repos missing**
  - Classic token likely missing `repo` scope, or
  - Fine-grained token lacks repo access, or
  - SSO org authorization is required.
- **Grouping disabled unexpectedly**
  - Check popup toggle; grouping only happens when enabled.

## Project Files

- `manifest.json` - extension metadata and permissions
- `background.js` - sync logic and tab group lifecycle
- `popup.html` / `popup.css` / `popup.js` - popup UI and controls
- `make-icons.py` / `generate-icons.html` - icon generation helpers
