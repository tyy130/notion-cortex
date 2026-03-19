import { Client } from '@notionhq/client';

let _client: Client | null = null;

export function getNotionClient(): Client {
  if (!_client) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) throw new Error('NOTION_API_KEY env var is required');
    _client = new Client({ auth: apiKey });
  }
  return _client;
}
