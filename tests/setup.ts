// Load .env before any test runs so getNotionClient() and other
// env-reading modules don't throw at import time.
import 'dotenv/config';

// Set stubs so tests that import env-reading modules don't crash.
process.env.NOTION_API_KEY ??= 'test-key';
process.env.ANTHROPIC_API_KEY ??= 'test-key';
process.env.NOTION_PARENT_PAGE_ID ??= 'test-page-id';
