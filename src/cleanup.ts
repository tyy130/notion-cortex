#!/usr/bin/env node
// Deletes (archives) all cortex-* databases and their child pages from the parent page.
// Usage: npx tsx src/cleanup.ts

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Client } from '@notionhq/client';

const CONFIG_PATH = join(homedir(), '.notion-cortex.json');

function loadConfig(): Record<string, string> {
  if (existsSync(CONFIG_PATH)) {
    try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; }
  }
  return {};
}

async function main() {
  const cfg = loadConfig();
  const apiKey = process.env.NOTION_API_KEY ?? cfg.notionApiKey;
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID ?? cfg.notionParentPageId;

  if (!apiKey || !parentPageId) {
    console.error('Missing NOTION_API_KEY or NOTION_PARENT_PAGE_ID');
    process.exit(1);
  }

  const notion = new Client({ auth: apiKey });
  const targetId = parentPageId.replace(/-/g, '');

  // Find all cortex-* databases under the parent page
  console.log('🔍 Scanning for cortex databases...\n');
  let cursor: string | undefined;
  const dbsToArchive: { id: string; title: string }[] = [];

  do {
    const response = await notion.search({
      filter: { value: 'database', property: 'object' },
      ...(cursor ? { start_cursor: cursor } : {}),
    } as any);

    for (const db of response.results) {
      if (db.object !== 'database') continue;
      const parentId = (db as any).parent?.page_id?.replace(/-/g, '');
      if (parentId !== targetId) continue;
      const title = (db as any).title?.[0]?.plain_text ?? '';
      if (title.startsWith('cortex-')) {
        dbsToArchive.push({ id: db.id, title });
      }
    }
    cursor = (response as any).next_cursor ?? undefined;
  } while (cursor);

  if (dbsToArchive.length === 0) {
    console.log('No cortex databases found — workspace is clean.\n');
    return;
  }

  console.log(`Found ${dbsToArchive.length} databases to archive:`);
  for (const db of dbsToArchive) {
    console.log(`  - ${db.title} (${db.id})`);
  }
  console.log();

  // Archive each database (this also hides all its child pages)
  for (const db of dbsToArchive) {
    try {
      await notion.blocks.delete({ block_id: db.id });
      console.log(`  🗑️  Archived: ${db.title}`);
    } catch (err) {
      console.warn(`  ⚠️  Failed to archive ${db.title}: ${(err as Error).message}`);
    }
  }

  // Also find and archive standalone pages (like output pages, synthesis pages)
  console.log('\n🔍 Scanning for cortex output pages...\n');
  let pageCursor: string | undefined;
  const pagesToArchive: { id: string; title: string }[] = [];

  do {
    const response = await notion.search({
      filter: { value: 'page', property: 'object' },
      ...(pageCursor ? { start_cursor: pageCursor } : {}),
    } as any);

    for (const page of response.results) {
      if (page.object !== 'page') continue;
      const parentId = (page as any).parent?.page_id?.replace(/-/g, '');
      if (parentId !== targetId) continue;
      const title = (page as any).properties?.title?.title?.[0]?.plain_text ?? '';
      if (title.startsWith('Intelligence Brief:') || title === 'Cortex') {
        pagesToArchive.push({ id: page.id, title });
      }
    }
    pageCursor = (response as any).next_cursor ?? undefined;
  } while (pageCursor);

  for (const page of pagesToArchive) {
    try {
      await notion.blocks.delete({ block_id: page.id });
      console.log(`  🗑️  Archived: ${page.title}`);
    } catch (err) {
      console.warn(`  ⚠️  Failed to archive ${page.title}: ${(err as Error).message}`);
    }
  }

  console.log('\n✅ Workspace cleaned. Run the orchestrator to start fresh.\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
