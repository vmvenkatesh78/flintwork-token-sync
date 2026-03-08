import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { GlobalToken, SemanticToken, ComponentToken } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a global token category to its output filename.
 */
const CATEGORY_FILES: Record<string, string> = {
  color: 'colors.json',
  spacing: 'spacing.json',
  radii: 'radii.json',
  shadow: 'shadows.json',
  fontSize: 'typography.json',
  fontWeight: 'typography.json',
  fontFamily: 'typography.json',
  lineHeight: 'typography.json',
};

/**
 * Sets a nested value in an object using a dot-notation path.
 *
 * "color.blue.500" with value "#217CF5" becomes:
 * { color: { blue: { "500": { "$value": "#217CF5" } } } }
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = parts[parts.length - 1];
  if (lastKey) {
    current[lastKey] = value;
  }
}

/**
 * Determines the $value format based on the token value.
 * Arrays (font families) are stored as arrays.
 * Numbers (font weights) are stored as numbers.
 * Everything else is a string.
 */
function formatValue(value: string, type: string): string | number | string[] {
  // Font family: comma-separated → array
  if (type === 'fontFamily' && value.includes(',')) {
    return value.split(',').map((s) => s.trim());
  }

  // Font weight and line height: numeric values
  if (type === 'fontWeight' || type === 'lineHeight') {
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
  }

  return value;
}

/**
 * Writes a JSON file, creating directories as needed.
 */
function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Global tokens → JSON files
// ---------------------------------------------------------------------------

/**
 * Groups global tokens by category and writes them to the appropriate
 * JSON files in the global/ directory.
 *
 * Tokens with the same category file (e.g., fontSize, fontWeight, fontFamily
 * all go to typography.json) are merged into one file.
 */
function generateGlobalFiles(tokens: GlobalToken[], outputDir: string): string[] {
  // Group tokens by output file
  const fileGroups = new Map<string, GlobalToken[]>();

  for (const token of tokens) {
    const fileName = CATEGORY_FILES[token.category] ?? `${token.category}.json`;
    const existing = fileGroups.get(fileName) ?? [];
    existing.push(token);
    fileGroups.set(fileName, existing);
  }

  const writtenFiles: string[] = [];

  for (const [fileName, groupTokens] of fileGroups) {
    const json: Record<string, unknown> = {};

    for (const token of groupTokens) {
      const formattedValue = formatValue(token.value, token.type);
      setNestedValue(json, token.name, { $value: formattedValue });
    }

    const filePath = join(outputDir, 'global', fileName);
    writeJsonFile(filePath, json);
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}

// ---------------------------------------------------------------------------
// Semantic tokens → JSON files
// ---------------------------------------------------------------------------

/**
 * Groups semantic tokens by theme and writes light.json and dark.json
 * to the semantic/ directory.
 */
function generateSemanticFiles(tokens: SemanticToken[], outputDir: string): string[] {
  const themeGroups = new Map<string, SemanticToken[]>();

  for (const token of tokens) {
    const existing = themeGroups.get(token.theme) ?? [];
    existing.push(token);
    themeGroups.set(token.theme, existing);
  }

  const writtenFiles: string[] = [];

  for (const [theme, themeTokens] of themeGroups) {
    const json: Record<string, unknown> = {};

    for (const token of themeTokens) {
      setNestedValue(json, token.name, { $value: token.reference });
    }

    const filePath = join(outputDir, 'semantic', `${theme}.json`);
    writeJsonFile(filePath, json);
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}

// ---------------------------------------------------------------------------
// Component tokens → JSON files
// ---------------------------------------------------------------------------

/**
 * Groups component tokens by component name and writes individual
 * JSON files (button.json, dialog.json, etc.) to the component/ directory.
 */
function generateComponentFiles(tokens: ComponentToken[], outputDir: string): string[] {
  const componentGroups = new Map<string, ComponentToken[]>();

  for (const token of tokens) {
    const existing = componentGroups.get(token.component) ?? [];
    existing.push(token);
    componentGroups.set(token.component, existing);
  }

  const writtenFiles: string[] = [];

  for (const [component, componentTokens] of componentGroups) {
    const json: Record<string, unknown> = {};

    for (const token of componentTokens) {
      setNestedValue(json, token.name, { $value: token.reference });
    }

    const filePath = join(outputDir, 'component', `${component}.json`);
    writeJsonFile(filePath, json);
    writtenFiles.push(filePath);
  }

  return writtenFiles;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GenerateResult {
  files: string[];
  globalFiles: number;
  semanticFiles: number;
  componentFiles: number;
}

/**
 * Generates all JSON token files from Notion data.
 *
 * Writes to the directory structure that flintwork's build-tokens.ts expects:
 *   outputDir/global/colors.json
 *   outputDir/global/spacing.json
 *   outputDir/semantic/light.json
 *   outputDir/semantic/dark.json
 *   outputDir/component/button.json
 *   etc.
 */
export function generateTokenFiles(
  global: GlobalToken[],
  semantic: SemanticToken[],
  component: ComponentToken[],
  outputDir: string,
): GenerateResult {
  const globalFiles = generateGlobalFiles(global, outputDir);
  const semanticFiles = generateSemanticFiles(semantic, outputDir);
  const componentFiles = generateComponentFiles(component, outputDir);

  return {
    files: [...globalFiles, ...semanticFiles, ...componentFiles],
    globalFiles: globalFiles.length,
    semanticFiles: semanticFiles.length,
    componentFiles: componentFiles.length,
  };
}
