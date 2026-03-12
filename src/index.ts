import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config as loadEnv } from 'dotenv';
import { createMcpServer } from './mcp-server/server.js';
import type { SyncConfig } from './core/types.js';

// ---------------------------------------------------------------------------
// Load environment
// ---------------------------------------------------------------------------

loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error(`Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
  return value;
}

const syncConfig: SyncConfig = {
  notionToken: requireEnv('NOTION_TOKEN'),
  globalDbId: requireEnv('NOTION_GLOBAL_DB'),
  semanticDbId: requireEnv('NOTION_SEMANTIC_DB'),
  componentDbId: requireEnv('NOTION_COMPONENT_DB'),
  buildLogDbId: requireEnv('NOTION_BUILD_LOG_DB'),
  flintworkTokensPath: process.env['FLINTWORK_TOKENS_PATH'] ?? '../flintwork/src/tokens',
};

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const server = createMcpServer(syncConfig);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});