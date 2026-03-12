import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { GlobalToken, SemanticToken, ComponentToken } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenChange {
  /** Token name (dot-notation path) */
  name: string;
  /** Which tier this token belongs to */
  tier: 'global' | 'semantic' | 'component';
  /** Type of change */
  change: 'added' | 'removed' | 'modified';
  /** Previous value (from disk). Undefined for added tokens. */
  before?: string;
  /** New value (from Notion). Undefined for removed tokens. */
  after?: string;
}

export interface DiffResult {
  /** All detected changes */
  changes: TokenChange[];
  /** Tokens only in Notion, not on disk */
  added: number;
  /** Tokens only on disk, not in Notion */
  removed: number;
  /** Tokens with different values */
  modified: number;
  /** Tokens with identical values */
  unchanged: number;
  /** Total tokens compared */
  total: number;
}

// ---------------------------------------------------------------------------
// Read JSON files from disk
// ---------------------------------------------------------------------------

/**
 * Recursively flattens a nested JSON object into dot-notation paths with values.
 * Extracts the `$value` field from token objects.
 */
function flattenJsonTokens(
  obj: Record<string, unknown>,
  prefix: string = '',
): Map<string, string> {
  const results = new Map<string, string>();

  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('$')) continue;

    const currentPath = prefix ? `${prefix}.${key}` : key;

    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>;
      if ('$value' in record) {
        const value = record['$value'];
        // Normalize: arrays to comma-separated, numbers to string
        if (Array.isArray(value)) {
          results.set(currentPath, value.join(', '));
        } else {
          results.set(currentPath, String(value));
        }
      } else {
        const nested = flattenJsonTokens(record, currentPath);
        for (const [k, v] of nested) {
          results.set(k, v);
        }
      }
    }
  }

  return results;
}

/**
 * Safely reads and parses a JSON file. Returns empty object on failure.
 */
function readJsonSafe(filePath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Reads all global tokens from JSON files on disk.
 * Returns a map of token name → value.
 */
function readGlobalFromDisk(tokensPath: string): Map<string, string> {
  const globalDir = join(tokensPath, 'global');
  if (!existsSync(globalDir)) return new Map();

  const combined = new Map<string, string>();
  const files = readdirSync(globalDir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const json = readJsonSafe(join(globalDir, file));
    const tokens = flattenJsonTokens(json);
    for (const [k, v] of tokens) {
      combined.set(k, v);
    }
  }

  return combined;
}

/**
 * Reads semantic tokens from a specific theme file on disk.
 * Returns a map of token name → reference/value.
 */
function readSemanticFromDisk(tokensPath: string, theme: string): Map<string, string> {
  const filePath = join(tokensPath, 'semantic', `${theme}.json`);
  if (!existsSync(filePath)) return new Map();

  const json = readJsonSafe(filePath);
  return flattenJsonTokens(json);
}

/**
 * Reads component tokens from a specific component file on disk.
 * Returns a map of token name → reference.
 */
function readComponentFromDisk(tokensPath: string, component: string): Map<string, string> {
  const filePath = join(tokensPath, 'component', `${component}.json`);
  if (!existsSync(filePath)) return new Map();

  const json = readJsonSafe(filePath);
  return flattenJsonTokens(json);
}

// ---------------------------------------------------------------------------
// Diff logic
// ---------------------------------------------------------------------------

/**
 * Compares two maps and returns the differences.
 */
function diffMaps(
  disk: Map<string, string>,
  notion: Map<string, string>,
  tier: TokenChange['tier'],
): TokenChange[] {
  const changes: TokenChange[] = [];

  // Modified or unchanged (in both)
  for (const [name, diskValue] of disk) {
    const notionValue = notion.get(name);
    if (notionValue === undefined) {
      changes.push({ name, tier, change: 'removed', before: diskValue });
    } else if (diskValue !== notionValue) {
      changes.push({ name, tier, change: 'modified', before: diskValue, after: notionValue });
    }
  }

  // Added (in Notion but not on disk)
  for (const [name, notionValue] of notion) {
    if (!disk.has(name)) {
      changes.push({ name, tier, change: 'added', after: notionValue });
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compares current Notion token state against JSON files on disk.
 *
 * Reads all token JSON files from `tokensPath`, normalizes them to
 * name → value maps, then compares against the provided Notion data.
 *
 * Returns a structured diff showing what was added, removed, or modified.
 * This is what the designer sees: "here's what will change if you sync."
 */
export function diffTokens(
  global: GlobalToken[],
  semantic: SemanticToken[],
  component: ComponentToken[],
  tokensPath: string,
): DiffResult {
  const changes: TokenChange[] = [];

  // --- Global tokens ---
  const globalDisk = readGlobalFromDisk(tokensPath);
  const globalNotion = new Map<string, string>();
  for (const token of global) {
    globalNotion.set(token.name, token.value);
  }
  changes.push(...diffMaps(globalDisk, globalNotion, 'global'));

  // --- Semantic tokens (per theme) ---
  const semanticByTheme = new Map<string, SemanticToken[]>();
  for (const token of semantic) {
    const existing = semanticByTheme.get(token.theme) ?? [];
    existing.push(token);
    semanticByTheme.set(token.theme, existing);
  }

  // Also check for themes that exist on disk but not in Notion
  const semanticDir = join(tokensPath, 'semantic');
  const diskThemes = new Set<string>();
  if (existsSync(semanticDir)) {
    for (const file of readdirSync(semanticDir).filter((f) => f.endsWith('.json'))) {
      diskThemes.add(basename(file, '.json'));
    }
  }
  const allThemes = new Set([...semanticByTheme.keys(), ...diskThemes]);

  for (const theme of allThemes) {
    const disk = readSemanticFromDisk(tokensPath, theme);
    const notion = new Map<string, string>();
    for (const token of semanticByTheme.get(theme) ?? []) {
      notion.set(token.name, token.reference);
    }
    changes.push(...diffMaps(disk, notion, 'semantic'));
  }

  // --- Component tokens (per component) ---
  const componentByName = new Map<string, ComponentToken[]>();
  for (const token of component) {
    const existing = componentByName.get(token.component) ?? [];
    existing.push(token);
    componentByName.set(token.component, existing);
  }

  const componentDir = join(tokensPath, 'component');
  const diskComponents = new Set<string>();
  if (existsSync(componentDir)) {
    for (const file of readdirSync(componentDir).filter((f) => f.endsWith('.json'))) {
      diskComponents.add(basename(file, '.json'));
    }
  }
  const allComponents = new Set([...componentByName.keys(), ...diskComponents]);

  for (const comp of allComponents) {
    const disk = readComponentFromDisk(tokensPath, comp);
    const notion = new Map<string, string>();
    for (const token of componentByName.get(comp) ?? []) {
      notion.set(token.name, token.reference);
    }
    changes.push(...diffMaps(disk, notion, 'component'));
  }

  // --- Summarize ---
  const added = changes.filter((c) => c.change === 'added').length;
  const removed = changes.filter((c) => c.change === 'removed').length;
  const modified = changes.filter((c) => c.change === 'modified').length;
  const totalCompared = global.length + semantic.length + component.length;
  const unchanged = totalCompared - added - modified;

  return {
    changes,
    added,
    removed,
    modified,
    unchanged: Math.max(0, unchanged),
    total: totalCompared,
  };
}