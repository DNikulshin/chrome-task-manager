# Chrome Web Store listing (en)

**Name:** Task Manager — side panel to-do list

**Short description (max 132 chars):**
Task list in Chrome's side panel: priorities, filters, search, export. No account, no network.

**Category:** Productivity / Tools
**Languages:** Russian, English

## Full description

Your tasks stay next to the page you are working on, in Chrome's side panel. Open it
with the toolbar icon or Ctrl+B — no tab switching.

FEATURES
• Add with Enter, edit, delete with confirmation
• High priority flag and "important" badge
• Reorder by dragging a handle — with mouse, keyboard (Space + arrows) or touch
• Filters All / Active / Done with counters, and multi-word search with highlights
• Undo the last delete, clear-completed or import right from the notification
• JSON export and import for backups and moving between browsers
• Compact view and dark theme
• Russian and English interface

PRIVACY
No network requests at all. Tasks live in your browser only (chrome.storage.local).
No analytics, no account, no access to page content.

PERMISSIONS
• sidePanel — render the UI in the side panel
• storage — keep tasks and settings locally

NOT INCLUDED (yet)
• Sync between devices (use export/import to move data)
• Reminders and notifications

## Permission justification (for reviewers)

- `sidePanel` — the only way to render the extension UI in Chrome's side panel.
- `storage` — persist the task list and preferences in `chrome.storage.local`.
- No `tabs`, `activeTab` or host permissions are requested: the extension does not
  read pages and makes no network calls. Unavailability of the panel on `chrome://`
  pages is detected from the `chrome.sidePanel.open()` rejection.

## Screenshots

1. `docs/screenshots/panel-light.png`
2. `docs/screenshots/panel-dark.png`
3. `docs/screenshots/popup.png`
