# Flomo Sync — Obsidian Plugin

Sync your [Flomo](https://flomoapp.com) memos to Obsidian. Auto-login, tag-based folders, incremental updates.

## Features

- **One-click login**: Log in to Flomo directly from Obsidian — no manual token copying
- **Full sync**: Fetches all your Flomo memos and converts them to Markdown
- **Tag-based folders**: Memos are organized into folders matching your Flomo tag hierarchy
- **Incremental updates**: Detects new, updated, and deleted memos
- **Auto sync**: Optional sync on startup + configurable interval
- **HTML → Markdown**: Converts rich text (bold, italic, highlights, blockquotes, lists, images) to clean Markdown
- **Frontmatter**: Each memo includes YAML frontmatter with date, slug, source, and tags

## How It Works

```
Flomo → Login → Fetch all memos → Convert HTML to Markdown → Write to vault
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

### From Community Plugins (coming soon)

1. Open Settings → Community Plugins → Browse
2. Search for "Flomo Sync"
3. Install and enable

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

1. Open plugin settings
2. Click **🔑 Login with Flomo**
3. Log in to your Flomo account in the popup window
4. Token is captured automatically — done!

> **Note**: The token may expire periodically. If sync stops working, click Login again.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
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

## Disclosures

> **Network access**: This plugin connects to `flomoapp.com` to fetch your memos. All data is stored locally in your Obsidian vault.
>
> **Unofficial API**: This plugin uses Flomo's internal web API (the same endpoints used by the Flomo web app). It is **not** an official Flomo integration and may break if Flomo changes their API. Use at your own discretion.
>
> **Desktop only**: The auto-login feature requires Electron (Obsidian desktop). This plugin does not work on mobile.
>
> **No tracking**: This plugin does not collect any analytics, telemetry, or personal data.

## Feedback

Questions, bugs, or feature requests? Reach out at **hello@delicatewatermelon.com**

## License

MIT © [Zihong Chen](https://delicatewatermelon.com)
