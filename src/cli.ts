import { config as loadEnv } from 'dotenv';
import { createNotionClient, readGlobalTokens, readSemanticTokens, readComponentTokens } from './core/notion-client.js';
import { validateTokens } from './core/validate.js';
import { runTokenBuild } from './core/build.js';
import { sync, readAllTokens } from './core/sync.js';
import type { SyncConfig } from './core/types.js';

// ---------------------------------------------------------------------------
// Load environment
// ---------------------------------------------------------------------------

loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const config: SyncConfig = {
  notionToken: requireEnv('NOTION_TOKEN'),
  globalDbId: requireEnv('NOTION_GLOBAL_DB'),
  semanticDbId: requireEnv('NOTION_SEMANTIC_DB'),
  componentDbId: requireEnv('NOTION_COMPONENT_DB'),
  flintworkTokensPath: process.env['FLINTWORK_TOKENS_PATH'] ?? '../flintwork/src/tokens',
};

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

async function commandValidate(): Promise<void> {
  const notion = createNotionClient(config.notionToken);

  console.log('Reading tokens from Notion...');
  const tokens = await readAllTokens(notion, config);

  console.log(`  Global:    ${tokens.global.length}`);
  console.log(`  Semantic:  ${tokens.semantic.length}`);
  console.log(`  Component: ${tokens.component.length}`);

  console.log('\nValidating...');
  const result = validateTokens(tokens.global, tokens.semantic, tokens.component);

  if (result.valid) {
    console.log(`\n  ✓ All ${result.tokenCount} tokens are valid.\n`);
    return;
  }

  console.error(`\n  ✗ ${result.errors.length} error(s):\n`);
  for (const error of result.errors) {
    console.error(`    • ${error.token}: ${error.message}`);
  }
  process.exit(1);
}

async function commandBuild(): Promise<void> {
  console.log('Running token build...');
  const result = runTokenBuild(config.flintworkTokensPath);
  console.log(result.output);

  if (!result.success) {
    process.exit(1);
  }
  console.log(`\n  ✓ Build complete in ${result.duration}ms.\n`);
}

async function commandSync(): Promise<void> {
  const notion = createNotionClient(config.notionToken);

  console.log('Starting full sync...\n');
  const result = await sync(notion, config);

  if (!result.success && result.validationErrors.length > 0) {
    console.error(`  ✗ ${result.validationErrors.length} validation error(s):\n`);
    for (const error of result.validationErrors) {
      console.error(`    • ${error.token}: ${error.message}`);
    }
    console.log(`\n  Updated ${result.statusUpdates} error rows in Notion.\n`);
    process.exit(1);
  }

  if (!result.success) {
    console.error(`  ✗ Build failed:\n${result.buildOutput}`);
    process.exit(1);
  }

  console.log(`  Read:      ${result.totalTokens} tokens (${result.globalCount} global, ${result.semanticCount} semantic, ${result.componentCount} component)`);
  console.log(`  Validated: ${result.totalTokens} tokens, 0 errors`);
  console.log(`  Build:     success`);
  console.log(`  Status:    updated ${result.statusUpdates} rows in Notion`);
  console.log(`\n🔗 Token sync complete.\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'sync';

  console.log(`\n🔗 flintwork-token-sync\n`);

  switch (command) {
    case 'validate':
      await commandValidate();
      break;
    case 'build':
      await commandBuild();
      break;
    case 'sync':
      await commandSync();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage: flintwork-token-sync [sync|validate|build]');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
