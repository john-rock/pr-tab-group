# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

No build step. This is a plain Manifest V3 Chrome extension — edit files and reload.

**To reload after changes:**
1. Go to `chrome://extensions`
2. Click **Reload** on **PR Review Queue**

**To install for the first time:**
1. `chrome://extensions` → enable Developer mode → Load unpacked → select this folder

## Architecture

The extension has two runtime contexts that communicate via `chrome.runtime.sendMessage`:

**`background.js`** — Service worker. Owns all state and logic:
- `windowGroups` (in-memory `Map<windowId, groupId>`) tracks which tab group belongs to each window; persisted to `chrome.storage.session` so it survives service worker restarts
- `syncPRTabs()` is the core sync function: fetches PRs from GitHub, opens missing tabs, closes tabs for closed PRs, and groups tabs under the "Review Queue" group
- GitHub token is stored in `chrome.storage.local` (with one-time migration from legacy `chrome.storage.sync`)
- `enabled` flag is stored in `chrome.storage.sync`
- Sync runs on a 15-minute `chrome.alarms` alarm named `pr-sync`, on install/startup, and on-demand via `SYNC_NOW` message

**`popup.js`** — Popup UI. Reads storage directly for display, sends messages to background for actions:
- Messages: `GET_STATUS`, `SYNC_NOW`, `VALIDATE_TOKEN`, `ENABLE_CHANGED`
- `refreshUI()` is the main render function; it also re-runs whenever `chrome.storage.onChanged` fires for `syncState`
- `syncState` in `chrome.storage.local` drives status display: `no_token | syncing | ok | error`

**`content.js`** — Minimal content script; currently unused beyond being declared in manifest.

## Key behaviors to preserve

- URL normalization (`normalizeUrl`) collapses PR sub-pages (`/files`, `?query`) to the base PR URL to avoid duplicate tabs
- `getValidGroupId` validates the cached group ID before using it — service workers restart and the in-memory map can hold stale IDs
- The GitHub search uses a 60-day `created:>` window to limit results; PRs older than 60 days won't appear
- SSO org detection reads the `X-GitHub-SSO` response header and surfaces a warning in the popup
- Fine-grained PATs return no `X-OAuth-Scopes` header — absence of scopes is treated as fine-grained, not as missing scope
