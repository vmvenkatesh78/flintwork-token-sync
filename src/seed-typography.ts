import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from '@notionhq/client';

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

const NOTION_TOKEN = requireEnv('NOTION_TOKEN');
const SEMANTIC_DB = requireEnv('NOTION_SEMANTIC_DB');
const TOKENS_PATH = process.env['FLINTWORK_TOKENS_PATH'] ?? '../flintwork/src/tokens';

const notion = new Client({ auth: NOTION_TOKEN });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenTokens(
  obj: Record<string, unknown>,
  prefix: string = '',
): Array<{ path: string; value: unknown }> {
  const results: Array<{ path: string; value: unknown }> = [];

  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;

    const currentPath = prefix ? `${prefix}.${key}` : key;

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      if ('$value' in record) {
        results.push({ path: currentPath, value: record['$value'] });
      } else {
        results.push(...flattenTokens(record, currentPath));
      }
    }
  }

  return results;
}

function valueToString(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n🌱 Seeding typography semantic tokens...\n');

  const filePath = join(TOKENS_PATH, 'semantic', 'typography.json');

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`Failed to read ${filePath}:`, error);
    process.exit(1);
  }

  const tokens = flattenTokens(json);
  let count = 0;

  for (const token of tokens) {
    const reference = valueToString(token.value);
    console.log(`  Semantic (typography): ${token.path} → ${reference}`);

    await notion.pages.create({
      parent: { database_id: SEMANTIC_DB },
      properties: {
        Name: { title: [{ type: 'text', text: { content: token.path } }] },
        Reference: { rich_text: [{ type: 'text', text: { content: reference } }] },
        Theme: { select: { name: 'typography' } },
        Status: { select: { name: 'synced' } },
        'Last Synced': { date: { start: new Date().toISOString() } },
      },
    });

    await delay(350);
    count++;
  }

  console.log(`\n🌱 Done. ${count} typography tokens seeded.\n`);
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});