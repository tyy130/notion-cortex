#!/usr/bin/env node
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createInterface } from 'readline';
import { runOrchestrator } from './orchestrator.js';

const CONFIG_PATH = join(homedir(), '.notion-cortex.json');

interface Config {
  provider?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  notionApiKey?: string;
  notionParentPageId?: string;
}

function loadConfig(): Config {
  if (existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch {}
  }
  return {};
}

// Apply saved config as fallback — env vars and .env always take precedence
function applyConfig(cfg: Config) {
  if (cfg.provider && !process.env.CORTEX_PROVIDER)
    process.env.CORTEX_PROVIDER = cfg.provider;
  if (cfg.openaiApiKey && !process.env.OPENAI_API_KEY)
    process.env.OPENAI_API_KEY = cfg.openaiApiKey;
  if (cfg.anthropicApiKey && !process.env.ANTHROPIC_API_KEY)
    process.env.ANTHROPIC_API_KEY = cfg.anthropicApiKey;
  if (cfg.notionApiKey && !process.env.NOTION_API_KEY)
    process.env.NOTION_API_KEY = cfg.notionApiKey;
  if (cfg.notionParentPageId && !process.env.NOTION_PARENT_PAGE_ID)
    process.env.NOTION_PARENT_PAGE_ID = cfg.notionParentPageId;
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve =>
    rl.question(question, ans => {
      rl.close();
      resolve(ans.trim());
    }),
  );
}

async function setup() {
  console.log('\n🧠 Notion Cortex — first-time setup\n');
  const cfg: Config = loadConfig();

  const provider = await ask(`LLM provider — openai or anthropic [${cfg.provider ?? 'openai'}]: `);
  cfg.provider = provider || cfg.provider || 'openai';

  if (cfg.provider === 'anthropic') {
    const key = await ask(`Anthropic API key${cfg.anthropicApiKey ? ' [keep existing]' : ''}: `);
    if (key) cfg.anthropicApiKey = key;
  } else {
    const key = await ask(`OpenAI API key${cfg.openaiApiKey ? ' [keep existing]' : ''}: `);
    if (key) cfg.openaiApiKey = key;
  }

  const notionKey = await ask(`Notion integration token${cfg.notionApiKey ? ' [keep existing]' : ''}: `);
  if (notionKey) cfg.notionApiKey = notionKey;

  const pageId = await ask(`Notion parent page ID${cfg.notionParentPageId ? ` [${cfg.notionParentPageId}]` : ''}: `);
  if (pageId) cfg.notionParentPageId = pageId;

  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  console.log(`\n✅ Saved to ${CONFIG_PATH}`);
  console.log('Run: notion-cortex "your topic"\n');
}

async function main() {
  applyConfig(loadConfig());

  const args = process.argv.slice(2);

  if (args[0] === 'setup') {
    await setup();
    return;
  }

  const autoApprove = args.includes('--auto-approve');
  let topic = args.filter(a => !a.startsWith('--')).join(' ');

  // Interactive prompt when no topic given
  if (!topic) {
    topic = await ask('Topic to research: ');
  }

  if (!topic) {
    console.error('Error: topic is required.\nUsage: notion-cortex "topic" [--auto-approve]');
    process.exit(1);
  }

  const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
  if (!parentPageId) {
    console.error('\n⚠️  Not configured. Run: notion-cortex setup\n');
    process.exit(1);
  }

  // Validate required env vars before starting — fail fast with a clear message
  const missing: string[] = [];
  if (!process.env.NOTION_API_KEY) missing.push('NOTION_API_KEY');
  const provider = process.env.CORTEX_PROVIDER ?? 'openai';
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (provider !== 'anthropic' && !process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (missing.length > 0) {
    console.error(`\n⚠️  Missing required environment variables: ${missing.join(', ')}`);
    console.error('Run: notion-cortex setup\n');
    process.exit(1);
  }

  await runOrchestrator(topic, parentPageId, { autoApprove });
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
