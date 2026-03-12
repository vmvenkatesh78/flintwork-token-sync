import { Client } from '@notionhq/client';
import {
  readGlobalTokens,
  readSemanticTokens,
  readComponentTokens,
  writeStatusBatch,
} from './notion-client.js';
import { validateTokens } from './validate.js';
import { generateTokenFiles } from './generate-json.js';
import { runTokenBuild } from './build.js';
import { writeBuildLog, buildLogEntryFromResult } from './build-log.js';
import type {
  SyncConfig,
  SyncResult,
  StatusUpdate,
  GlobalToken,
  SemanticToken,
  ComponentToken,
  ValidationResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ReadResult {
  global: GlobalToken[];
  semantic: SemanticToken[];
  component: ComponentToken[];
  totalTokens: number;
}

/**
 * Reads all tokens from the three Notion databases.
 */
export async function readAllTokens(notion: Client, config: SyncConfig): Promise<ReadResult> {
  const global = await readGlobalTokens(notion, config.globalDbId);
  const semantic = await readSemanticTokens(notion, config.semanticDbId);
  const component = await readComponentTokens(notion, config.componentDbId);

  return {
    global,
    semantic,
    component,
    totalTokens: global.length + semantic.length + component.length,
  };
}

// ---------------------------------------------------------------------------
// Write status
// ---------------------------------------------------------------------------

/**
 * Writes error status back to Notion for tokens that failed validation.
 */
async function writeValidationErrors(
  notion: Client,
  tokens: ReadResult,
  validation: ValidationResult,
  timestamp: string,
): Promise<number> {
  const errorNames = new Set(validation.errors.map((e) => e.token));
  const errorMessages = new Map(validation.errors.map((e) => [e.token, e.message]));

  const updates: StatusUpdate[] = [];
  const allTokens = [
    ...tokens.global.map((t) => ({ pageId: t.pageId, name: t.name })),
    ...tokens.semantic.map((t) => ({ pageId: t.pageId, name: t.name })),
    ...tokens.component.map((t) => ({ pageId: t.pageId, name: t.name })),
  ];

  for (const token of allTokens) {
    if (errorNames.has(token.name)) {
      updates.push({
        pageId: token.pageId,
        status: 'error',
        error: errorMessages.get(token.name) ?? 'Validation failed',
        timestamp,
      });
    }
  }

  await writeStatusBatch(notion, updates);
  return updates.length;
}

/**
 * Writes success status back to Notion — only for rows not already synced.
 * This avoids updating all 217 rows on every sync, which would take ~76
 * seconds and exceed MCP tool call timeouts.
 */
async function writeSyncSuccess(
  notion: Client,
  tokens: ReadResult,
  timestamp: string,
): Promise<number> {
  const allTokens = [
    ...tokens.global,
    ...tokens.semantic,
    ...tokens.component,
  ];

  // Only update rows that aren't already "synced"
  const needsUpdate = allTokens.filter((t) => t.status !== 'synced');

  if (needsUpdate.length === 0) {
    return 0;
  }

  const updates: StatusUpdate[] = needsUpdate.map((t) => ({
    pageId: t.pageId,
    status: 'synced' as const,
    timestamp,
  }));

  await writeStatusBatch(notion, updates);
  return updates.length;
}

// ---------------------------------------------------------------------------
// Full sync
// ---------------------------------------------------------------------------

/**
 * Runs the complete token sync pipeline:
 *
 * 1. Read tokens from Notion
 * 2. Validate all tokens
 * 3. Generate JSON files for flintwork
 * 4. Run flintwork's token build
 * 5. Write status back to Notion
 * 6. Write build log entry
 *
 * This is the single source of truth for the sync pipeline.
 * Both the MCP server and CLI call this function.
 */
export async function sync(notion: Client, config: SyncConfig): Promise<SyncResult> {
  const timestamp = new Date().toISOString();

  // 1. Read
  const tokens = await readAllTokens(notion, config);

  // 2. Validate
  const validation = validateTokens(tokens.global, tokens.semantic, tokens.component);

  if (!validation.valid) {
    const updatedCount = await writeValidationErrors(notion, tokens, validation, timestamp);

    const result: SyncResult = {
      success: false,
      globalCount: tokens.global.length,
      semanticCount: tokens.semantic.length,
      componentCount: tokens.component.length,
      totalTokens: tokens.totalTokens,
      validationErrors: validation.errors,
      buildOutput: '',
      timestamp,
      statusUpdates: updatedCount,
    };

    // 6. Write build log
    await writeBuildLog(notion, config.buildLogDbId, buildLogEntryFromResult(result));

    return result;
  }

  // 3. Generate JSON files
  let generated;
  try {
    generated = generateTokenFiles(
      tokens.global,
      tokens.semantic,
      tokens.component,
      config.flintworkTokensPath,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'File generation failed';
    const result: SyncResult = {
      success: false,
      globalCount: tokens.global.length,
      semanticCount: tokens.semantic.length,
      componentCount: tokens.component.length,
      totalTokens: tokens.totalTokens,
      validationErrors: [],
      buildOutput: `JSON generation failed: ${errorMessage}`,
      timestamp,
      statusUpdates: 0,
    };

    await writeBuildLog(notion, config.buildLogDbId, buildLogEntryFromResult(result));

    return result;
  }

  // 4. Build
  const build = runTokenBuild(config.flintworkTokensPath);

  if (!build.success) {
    const result: SyncResult = {
      success: false,
      globalCount: tokens.global.length,
      semanticCount: tokens.semantic.length,
      componentCount: tokens.component.length,
      totalTokens: tokens.totalTokens,
      validationErrors: [],
      buildOutput: build.output,
      timestamp,
      statusUpdates: 0,
    };

    await writeBuildLog(notion, config.buildLogDbId, buildLogEntryFromResult(result));

    return result;
  }

  // 5. Write success status
  const updatedCount = await writeSyncSuccess(notion, tokens, timestamp);

  const result: SyncResult = {
    success: true,
    globalCount: tokens.global.length,
    semanticCount: tokens.semantic.length,
    componentCount: tokens.component.length,
    totalTokens: tokens.totalTokens,
    validationErrors: [],
    buildOutput: build.output,
    timestamp,
    statusUpdates: updatedCount,
  };

  // Write build log
  await writeBuildLog(notion, config.buildLogDbId, buildLogEntryFromResult(result));

  return result;
}