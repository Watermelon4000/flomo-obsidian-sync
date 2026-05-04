# Flomo Sync — Obsidian Plugin

Lightweight Flomo → Obsidian sync. No Playwright, no browser automation — just pure HTTP.

## Features

- **Full sync**: Fetches all your Flomo memos and converts them to Markdown
- **Tag-based folders**: Memos are organized into folders matching your Flomo tag hierarchy
- **Incremental updates**: Detects new, updated, and deleted memos
- **Auto sync**: Optional sync on startup + configurable interval
- **HTML → Markdown**: Converts rich text (bold, italic, highlights, blockquotes, lists, images) to clean Markdown
- **Frontmatter**: Each memo includes YAML frontmatter with date, slug, source, and tags

## How It Works

```
Flomo API → Fetch all memos → Convert HTML to Markdown → Write to Obsidian vault
                                                            ↓
                                                    flomo/
                                                    ├── project/content/
                                                    │   └── 2026-05-01_07-59-23.md
                                                    ├── story/dairy/
                                                    │   └── 2026-04-30_23-15-52.md
                                                    └── _untagged/
                                                        └── ...
```

Each memo becomes a Markdown file named by its creation timestamp. Files are organized into folders based on your Flomo tags. A memo with multiple tags is copied to all matching folders.

## Installation

### Manual Install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest)
2. Create a folder `flomo-sync` inside your vault's `.obsidian/plugins/` directory
3. Copy the three files into that folder
4. Restart Obsidian and enable the plugin in Settings → Community Plugins

### Build from Source

```bash
git clone https://github.com/Watermelon4000/flomo-obsidian-sync.git
cd flomo-obsidian-sync
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/flomo-sync/` directory.

## Setup

### Getting Your Bearer Token

1. Open [Flomo](https://v.flomoapp.com) in your browser
2. Open DevTools (F12) → Network tab
3. Refresh the page
4. Find any request to `flomoapp.com/api/` and copy the `Authorization` header value
5. Paste it into the plugin settings

> **Note**: The token may expire periodically. If sync stops working, grab a fresh token.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Bearer Token | — | Your Flomo API authorization token |
| Flomo Folder | `flomo` | Root folder in your vault for synced memos |
| Sync on Startup | Off | Auto-sync when Obsidian opens |
| Sync Interval | 60 min | How often to auto-sync (0 = disabled) |

## Commands

- **Sync Flomo Now** — Trigger a manual sync
- **Reset Flomo Sync History & Re-sync All** — Clear sync records and do a fresh full import

You can also click the 🔄 ribbon icon to sync.

## Output Format

Each memo is saved as a Markdown file with frontmatter:

```markdown
---
date: 2026-05-01 07:59:23
slug: MjM0NDE0NzA4
source: flomo
tags:
  - "project/content"
---

Your memo content here, converted from HTML to Markdown.

#project/content
```

## License

MIT © [Melon Chen](https://delicatewatermelon.com)
