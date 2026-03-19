import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Resolves to {pkg}/node_modules/.bin/notion-mcp-server regardless of CWD.
// Works both in development (dist/notion/) and when installed globally via npm.
const __dirname = dirname(fileURLToPath(import.meta.url));
const MCP_SERVER_BIN = resolve(__dirname, '..', '..', 'node_modules', '.bin', 'notion-mcp-server');

export interface MCPTool {
  name: string;
  description: string | undefined;
  input_schema: Record<string, unknown>;
}

export interface NotionMCPClient {
  tools: MCPTool[];
  callTool(name: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}

// Spawns the Notion MCP server as a child process and connects to it via
// stdio transport. Returns tool definitions compatible with the Anthropic SDK.
export async function createNotionMCPClient(
  notionApiKey: string,
): Promise<NotionMCPClient> {
  // Use the package-local bin instead of npx to avoid a network fetch on every run.
  const transport = new StdioClientTransport({
    command: MCP_SERVER_BIN,
    args: [],
    env: {
      ...process.env,
      OPENAPI_MCP_HEADERS: JSON.stringify({
        Authorization: `Bearer ${notionApiKey}`,
        'Notion-Version': '2022-06-28',
      }),
    },
  });

  const client = new Client(
    { name: 'notion-cortex', version: '1.0.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  const { tools } = await client.listTools();

  return {
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Record<string, unknown>,
    })),

    async callTool(name: string, input: unknown) {
      const result = await client.callTool({
        name,
        arguments: input as Record<string, unknown>,
      });
      return result;
    },

    async close() {
      await client.close();
    },
  };
}
