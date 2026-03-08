import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
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
const GLOBAL_DB = requireEnv('NOTION_GLOBAL_DB');
const SEMANTIC_DB = requireEnv('NOTION_SEMANTIC_DB');
const COMPONENT_DB = requireEnv('NOTION_COMPONENT_DB');
const TOKENS_PATH = process.env['FLINTWORK_TOKENS_PATH'] ?? '../flintwork/src/tokens';

const notion = new Client({ auth: NOTION_TOKEN });

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

/**
 * Recursively flattens a nested JSON object into dot-notation paths with $value.
 * Skips keys starting with $ (metadata like $type, $description).
 */
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

/**
 * Determines the token type from the value.
 */
function inferType(value: unknown): string {
  if (typeof value === 'number') return 'fontWeight';
  if (Array.isArray(value)) return 'fontFamily';
  if (typeof value === 'string') {
    if (value.startsWith('#')) return 'color';
    // Shadow check BEFORE dimension — shadow values contain 'px' but
    // are not dimensions. Multi-part values with commas or rgba are shadows.
    if (value.includes('rgba') || value.includes('rgb') || value.includes(',')) return 'shadow';
    if (value === 'none') return 'shadow';
    if (value === 'transparent') return 'color';
    if (value.includes('px') || value.includes('rem') || value.includes('em')) return 'dimension';
  }
  return 'dimension';
}

/**
 * Determines the category from the file name.
 */
function inferCategory(fileName: string): string {
  const name = basename(fileName, '.json');
  if (name === 'colors') return 'color';
  if (name === 'shadows') return 'shadow';
  if (name === 'typography') return 'fontSize'; // Will be overridden per-token
  return name;
}

/**
 * Refines category for typography tokens based on the path.
 */
function refineCategoryFromPath(path: string, defaultCategory: string): string {
  if (path.startsWith('fontFamily')) return 'fontFamily';
  if (path.startsWith('fontSize')) return 'fontSize';
  if (path.startsWith('fontWeight')) return 'fontWeight';
  if (path.startsWith('lineHeight')) return 'lineHeight';
  return defaultCategory;
}

/**
 * Formats a value as a string for Notion.
 */
function valueToString(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

// ---------------------------------------------------------------------------
// Notion row creation helpers
// ---------------------------------------------------------------------------

async function createGlobalRow(
  name: string,
  value: string,
  type: string,
  category: string,
): Promise<void> {
  await notion.pages.create({
    parent: { database_id: GLOBAL_DB },
    properties: {
      Name: { title: [{ type: 'text', text: { content: name } }] },
      Value: { rich_text: [{ type: 'text', text: { content: value } }] },
      Type: { select: { name: type } },
      Category: { select: { name: category } },
      Status: { select: { name: 'synced' } },
      'Last Synced': { date: { start: new Date().toISOString() } },
    },
  });
}

async function createSemanticRow(
  name: string,
  reference: string,
  theme: string,
): Promise<void> {
  await notion.pages.create({
    parent: { database_id: SEMANTIC_DB },
    properties: {
      Name: { title: [{ type: 'text', text: { content: name } }] },
      Reference: { rich_text: [{ type: 'text', text: { content: reference } }] },
      Theme: { select: { name: theme } },
      Status: { select: { name: 'synced' } },
      'Last Synced': { date: { start: new Date().toISOString() } },
    },
  });
}

async function createComponentRow(
  name: string,
  reference: string,
  component: string,
): Promise<void> {
  await notion.pages.create({
    parent: { database_id: COMPONENT_DB },
    properties: {
      Name: { title: [{ type: 'text', text: { content: name } }] },
      Reference: { rich_text: [{ type: 'text', text: { content: reference } }] },
      Component: { select: { name: component } },
      Status: { select: { name: 'synced' } },
      'Last Synced': { date: { start: new Date().toISOString() } },
    },
  });
}

// ---------------------------------------------------------------------------
// Safe JSON parser
// ---------------------------------------------------------------------------

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${filePath}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Rate limiter — Notion allows ~3 requests/second
// ---------------------------------------------------------------------------

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

async function seedGlobalTokens(): Promise<number> {
  const globalDir = join(TOKENS_PATH, 'global');
  const files = readdirSync(globalDir).filter((f) => f.endsWith('.json'));
  let count = 0;

  for (const file of files) {
    const filePath = join(globalDir, file);
    const json = readJsonFile(filePath);
    const tokens = flattenTokens(json);
    const fileCategory = inferCategory(file);

    for (const token of tokens) {
      const type = inferType(token.value);
      const category = refineCategoryFromPath(token.path, fileCategory);
      const value = valueToString(token.value);

      console.log(`  Global: ${token.path} = ${value}`);
      await createGlobalRow(token.path, value, type, category);
      await delay(350);
      count++;
    }
  }

  return count;
}

async function seedSemanticTokens(): Promise<number> {
  const semanticDir = join(TOKENS_PATH, 'semantic');
  const files = readdirSync(semanticDir).filter((f) => f.endsWith('.json'));
  let count = 0;

  for (const file of files) {
    const name = basename(file, '.json');
    // typography.json is not a theme file — skip it for semantic seeding
    if (name !== 'light' && name !== 'dark') continue;

    const filePath = join(semanticDir, file);
    const json = readJsonFile(filePath);
    const tokens = flattenTokens(json);

    for (const token of tokens) {
      const reference = String(token.value);
      console.log(`  Semantic (${name}): ${token.path} → ${reference}`);
      await createSemanticRow(token.path, reference, name);
      await delay(350);
      count++;
    }
  }

  return count;
}

async function seedComponentTokens(): Promise<number> {
  const componentDir = join(TOKENS_PATH, 'component');
  const files = readdirSync(componentDir).filter((f) => f.endsWith('.json'));
  let count = 0;

  for (const file of files) {
    const componentName = basename(file, '.json');
    const filePath = join(componentDir, file);
    const json = readJsonFile(filePath);
    const tokens = flattenTokens(json);

    for (const token of tokens) {
      const reference = String(token.value);
      console.log(`  Component (${componentName}): ${token.path} → ${reference}`);
      await createComponentRow(token.path, reference, componentName);
      await delay(350);
      count++;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n🌱 Seeding Notion databases from flintwork token files...\n');
  console.log(`  Token source: ${TOKENS_PATH}\n`);

  console.log('Seeding global tokens...');
  const globalCount = await seedGlobalTokens();
  console.log(`  ✓ ${globalCount} global tokens seeded.\n`);

  console.log('Seeding semantic tokens...');
  const semanticCount = await seedSemanticTokens();
  console.log(`  ✓ ${semanticCount} semantic tokens seeded.\n`);

  console.log('Seeding component tokens...');
  const componentCount = await seedComponentTokens();
  console.log(`  ✓ ${componentCount} component tokens seeded.\n`);

  const total = globalCount + semanticCount + componentCount;
  console.log(`🌱 Seed complete. ${total} tokens created across 3 databases.\n`);
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
