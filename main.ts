import { App, Plugin, PluginSettingTab, Setting, Notice, requestUrl } from 'obsidian';
import { createHash } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────

interface FlomoMemo {
  slug: string;
  content: string;
  tags: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
  linked_memos?: any[];
  files?: Array<{ url: string; name: string }>;
}

/** Per-memo sync record: tracks where files were written + when last updated */
interface SyncedMemoRecord {
  updated_at: string;
  fileName: string;       // e.g. "2026-04-12_08-42-02"
  filePaths: string[];    // all paths where this memo is stored
}

interface FlomoSyncSettings {
  bearerToken: string;
  flomoFolder: string;
  autoSyncOnStartup: boolean;
  autoSyncIntervalMinutes: number;
  lastSyncTime: number;
  /** slug → sync record (replaces old syncedSlugs: string[]) */
  syncedMemos: Record<string, SyncedMemoRecord>;
  // Legacy field, kept for migration
  syncedSlugs?: string[];
}

const DEFAULT_SETTINGS: FlomoSyncSettings = {
  bearerToken: '',
  flomoFolder: 'flomo',
  autoSyncOnStartup: false,
  autoSyncIntervalMinutes: 60,
  lastSyncTime: 0,
  syncedMemos: {},
};

// ─── Flomo API Client ────────────────────────────────────────────────

const FLOMO_API_URL = 'https://flomoapp.com/api/v1/memo/updated/';
const FLOMO_SALT = 'dbbc3dd73364b4084c3a69346e0ce2b2';
const FLOMO_LIMIT = 200;

function buildSignedParams(extra: Record<string, string> = {}): Record<string, string> {
  const params: Record<string, string> = {
    limit: String(FLOMO_LIMIT),
    tz: '8:0',
    timestamp: String(Math.floor(Date.now() / 1000)),
    api_key: 'flomo_web',
    app_version: '5.25.64',
    platform: 'mac',
    webp: '1',
    ...extra,
  };

  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map(k => `${k}=${params[k]}`).join('&');
  const sign = createHash('md5').update(paramStr + FLOMO_SALT).digest('hex');
  params.sign = sign;

  return params;
}

async function fetchMemos(token: string, latestSlug?: string, latestUpdatedAt?: number): Promise<FlomoMemo[]> {
  const extra: Record<string, string> = {};
  if (latestSlug && latestUpdatedAt) {
    extra.latest_slug = latestSlug;
    extra.latest_updated_at = String(latestUpdatedAt);
  }

  const params = buildSignedParams(extra);
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const url = `${FLOMO_API_URL}?${query}`;

  const resp = await requestUrl({
    url,
    method: 'GET',
    headers: { Authorization: token },
  });

  const data = resp.json;
  if (data.code !== 0) {
    throw new Error(`Flomo API error: ${JSON.stringify(data)}`);
  }

  return data.data || [];
}

async function fetchAllMemos(token: string): Promise<FlomoMemo[]> {
  const allMemos: FlomoMemo[] = [];
  let memos = await fetchMemos(token);
  allMemos.push(...memos);

  while (memos.length >= FLOMO_LIMIT) {
    const last = memos[memos.length - 1];
    const ts = Math.floor(new Date(last.updated_at).getTime() / 1000);
    memos = await fetchMemos(token, last.slug, ts);
    allMemos.push(...memos);
  }

  return allMemos;
}

// ─── HTML → Markdown Converter ───────────────────────────────────────

function htmlToMarkdown(html: string): string {
  let md = html;

  md = md.replace(/<mark>/gi, '==').replace(/<\/mark>/gi, '==');

  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    const inner = htmlToMarkdown(content).trim();
    return inner.split('\n').map(line => `> ${line}`).join('\n') + '\n';
  });

  md = md.replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, '**$2**');
  md = md.replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, '*$2*');
  md = md.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*\/?>/gi, '![]($1)');

  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
      return `- ${htmlToMarkdown(item).trim()}\n`;
    });
  });

  let counter = 0;
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    counter = 0;
    return content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => {
      counter++;
      return `${counter}. ${htmlToMarkdown(item).trim()}\n`;
    });
  });

  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n');

  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi');
    md = md.replace(re, `${'#'.repeat(i)} $1\n`);
  }

  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
  md = md.replace(/<[^>]+>/g, '');

  md = md.replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  md = md.replace(/\n{3,}/g, '\n\n').trim();

  return md;
}

// ─── Sync Logic ──────────────────────────────────────────────────────

interface SyncResult {
  total: number;
  newCount: number;
  updatedCount: number;
  deletedCount: number;
}

async function ensureDir(app: App, dirPath: string) {
  if (!(await app.vault.adapter.exists(dirPath))) {
    await app.vault.adapter.mkdir(dirPath);
  }
}

function extractTags(memo: FlomoMemo): string[] {
  if (!memo.tags || memo.tags.length === 0) return [];
  return memo.tags.map(t => {
    const name = t.name || (typeof t === 'string' ? t : '');
    return name.startsWith('#') ? name : `#${name}`;
  }).filter(t => t.length > 1);
}

function memoToMarkdown(memo: FlomoMemo): string {
  const md = htmlToMarkdown(memo.content);
  const tags = extractTags(memo);
  const tagLine = tags.length > 0 ? tags.join(' ') : '';
  const allTags = tags.map(t => `  - "${t.replace(/^#/, '')}"`).join('\n');

  return `---
date: ${memo.created_at}
slug: ${memo.slug}
source: flomo
tags:
${allTags || '  - untagged'}
---

${md}

${tagLine}
`.trimEnd() + '\n';
}

function memoFileName(memo: FlomoMemo): string {
  return memo.created_at.replace(/\s/g, '_').replace(/:/g, '-');
}

/** Compute which file paths a memo should be stored at */
function computeFilePaths(base: string, memo: FlomoMemo): string[] {
  const fileName = memoFileName(memo);
  const tags = extractTags(memo);

  if (tags.length === 0) {
    return [`${base}/_untagged/${fileName}.md`];
  }

  return tags.map(tag => {
    const tagPath = tag.replace(/^#/, '');
    return `${base}/${tagPath}/${fileName}.md`;
  });
}

/** Write a memo to all its target paths */
async function writeMemo(app: App, memo: FlomoMemo, filePaths: string[]) {
  const content = memoToMarkdown(memo);
  for (const filePath of filePaths) {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    const parts = dir.split('/');
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      await ensureDir(app, current);
    }
    await app.vault.adapter.write(filePath, content);
  }
}

/** Delete all files associated with a synced memo record */
async function deleteMemoFiles(app: App, record: SyncedMemoRecord) {
  for (const filePath of record.filePaths) {
    if (await app.vault.adapter.exists(filePath)) {
      await app.vault.adapter.remove(filePath);
    }
  }
}

async function syncToVault(
  app: App,
  settings: FlomoSyncSettings,
  memos: FlomoMemo[],
): Promise<SyncResult> {
  const base = settings.flomoFolder;
  const syncedMemos = settings.syncedMemos;
  let newCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;

  await ensureDir(app, base);

  // Build set of current API slugs
  const apiSlugs = new Set(memos.map(m => m.slug));

  // ── Step 1: Process memos from API (new + updated) ──
  for (const memo of memos) {
    const existing = syncedMemos[memo.slug];
    const filePaths = computeFilePaths(base, memo);
    const fileName = memoFileName(memo);

    if (!existing) {
      // NEW memo
      await writeMemo(app, memo, filePaths);
      syncedMemos[memo.slug] = {
        updated_at: memo.updated_at,
        fileName,
        filePaths,
      };
      newCount++;
    } else if (existing.updated_at !== memo.updated_at) {
      // UPDATED memo — delete old files, write new ones
      // (tags might have changed → different folders)
      await deleteMemoFiles(app, existing);
      await writeMemo(app, memo, filePaths);
      syncedMemos[memo.slug] = {
        updated_at: memo.updated_at,
        fileName,
        filePaths,
      };
      updatedCount++;
    }
    // else: unchanged, skip
  }

  // ── Step 2: Detect deletions (slugs we have but API doesn't) ──
  for (const slug of Object.keys(syncedMemos)) {
    if (!apiSlugs.has(slug)) {
      await deleteMemoFiles(app, syncedMemos[slug]);
      delete syncedMemos[slug];
      deletedCount++;
    }
  }

  settings.lastSyncTime = Date.now();

  return { total: memos.length, newCount, updatedCount, deletedCount };
}

// ─── Plugin ──────────────────────────────────────────────────────────

export default class FlomoSyncPlugin extends Plugin {
  settings: FlomoSyncSettings;
  syncIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();

    // Ribbon icon
    this.addRibbonIcon('sync', 'Flomo Sync', async () => {
      await this.runSync();
    });

    // Command: manual sync
    this.addCommand({
      id: 'flomo-sync-now',
      name: 'Sync Flomo Now',
      callback: async () => {
        await this.runSync();
      },
    });

    // Command: full re-sync
    this.addCommand({
      id: 'flomo-sync-reset',
      name: 'Reset Flomo Sync History & Re-sync All',
      callback: async () => {
        this.settings.syncedMemos = {};
        this.settings.lastSyncTime = 0;
        await this.saveSettings();
        new Notice('Flomo: Sync history cleared. Starting full sync...');
        await this.runSync();
      },
    });

    // Settings tab
    this.addSettingTab(new FlomoSyncSettingTab(this.app, this));

    // Auto sync on startup
    if (this.settings.autoSyncOnStartup && this.settings.bearerToken) {
      setTimeout(() => this.runSync(), 3000);
    }

    // Interval sync
    if (this.settings.autoSyncIntervalMinutes > 0 && this.settings.bearerToken) {
      this.startIntervalSync();
    }
  }

  onunload() {
    this.stopIntervalSync();
  }

  startIntervalSync() {
    this.stopIntervalSync();
    const ms = this.settings.autoSyncIntervalMinutes * 60 * 1000;
    if (ms > 0) {
      this.syncIntervalId = window.setInterval(() => this.runSync(), ms);
      this.registerInterval(this.syncIntervalId);
    }
  }

  stopIntervalSync() {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  async runSync() {
    if (!this.settings.bearerToken) {
      new Notice('Flomo Sync: Please set your Bearer token in settings.');
      return;
    }

    const token = this.settings.bearerToken.startsWith('Bearer ')
      ? this.settings.bearerToken
      : `Bearer ${this.settings.bearerToken}`;

    try {
      new Notice('Flomo: Syncing...');
      const memos = await fetchAllMemos(token);
      const result = await syncToVault(this.app, this.settings, memos);
      await this.saveSettings();

      const parts: string[] = [];
      if (result.newCount > 0) parts.push(`${result.newCount} new`);
      if (result.updatedCount > 0) parts.push(`${result.updatedCount} updated`);
      if (result.deletedCount > 0) parts.push(`${result.deletedCount} deleted`);

      if (parts.length > 0) {
        new Notice(`Flomo: ${parts.join(', ')}. (${result.total} total)`);
      } else {
        new Notice(`Flomo: All ${result.total} memos up to date ✓`);
      }
    } catch (error) {
      console.error('Flomo Sync error:', error);
      new Notice(`Flomo Sync failed: ${(error as Error).message}`);
    }
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    // Migrate from old syncedSlugs[] to new syncedMemos{}
    if (this.settings.syncedSlugs && this.settings.syncedSlugs.length > 0 && Object.keys(this.settings.syncedMemos).length === 0) {
      // Old format — can't reconstruct file paths, just clear and re-sync
      this.settings.syncedMemos = {};
      delete this.settings.syncedSlugs;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

// ─── Settings Tab ────────────────────────────────────────────────────

class FlomoSyncSettingTab extends PluginSettingTab {
  plugin: FlomoSyncPlugin;

  constructor(app: App, plugin: FlomoSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Flomo Sync Settings' });

    new Setting(containerEl)
      .setName('Bearer Token')
      .setDesc('从 Flomo 网页版 DevTools → Network → 请求头中获取 Authorization 值')
      .addText(text => text
        .setPlaceholder('Bearer 12345678|xxxxxx')
        .setValue(this.plugin.settings.bearerToken)
        .onChange(async (value) => {
          this.plugin.settings.bearerToken = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Flomo Folder')
      .setDesc('笔记按标签分文件夹保存到 Vault 中')
      .addText(text => text
        .setPlaceholder('flomo')
        .setValue(this.plugin.settings.flomoFolder)
        .onChange(async (value) => {
          this.plugin.settings.flomoFolder = value || 'flomo';
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: 'Auto Sync' });

    new Setting(containerEl)
      .setName('Sync on Startup')
      .setDesc('Obsidian 启动时自动同步')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoSyncOnStartup)
        .onChange(async (value) => {
          this.plugin.settings.autoSyncOnStartup = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Sync Interval (minutes)')
      .setDesc('定时同步间隔（分钟）。设为 0 关闭定时同步')
      .addText(text => text
        .setPlaceholder('60')
        .setValue(String(this.plugin.settings.autoSyncIntervalMinutes))
        .onChange(async (value) => {
          const mins = parseInt(value) || 0;
          this.plugin.settings.autoSyncIntervalMinutes = mins;
          await this.plugin.saveSettings();
          if (mins > 0) {
            this.plugin.startIntervalSync();
          } else {
            this.plugin.stopIntervalSync();
          }
        }));

    // Status display
    containerEl.createEl('h3', { text: 'Status' });

    const statusEl = containerEl.createEl('div', { cls: 'flomo-sync-status' });
    const syncedCount = Object.keys(this.plugin.settings.syncedMemos || {}).length;
    const lastSync = this.plugin.settings.lastSyncTime
      ? new Date(this.plugin.settings.lastSyncTime).toLocaleString()
      : 'Never';
    statusEl.createEl('p', { text: `📊 Synced memos: ${syncedCount}` });
    statusEl.createEl('p', { text: `🕐 Last sync: ${lastSync}` });

    // Action buttons
    new Setting(containerEl)
      .setName('Sync Now')
      .setDesc('手动触发一次同步')
      .addButton(btn => btn
        .setButtonText('🔄 Sync Now')
        .setCta()
        .onClick(async () => {
          await this.plugin.runSync();
          this.display();
        }));

    new Setting(containerEl)
      .setName('Reset Sync History')
      .setDesc('清除同步记录，下次同步将重新导入所有笔记')
      .addButton(btn => btn
        .setButtonText('⚠️ Reset')
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.syncedMemos = {};
          this.plugin.settings.lastSyncTime = 0;
          await this.plugin.saveSettings();
          new Notice('Flomo: Sync history cleared.');
          this.display();
        }));
  }
}
