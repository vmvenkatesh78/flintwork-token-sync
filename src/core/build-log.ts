import { Client } from '@notionhq/client';
import type { SyncResult } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildLogEntry {
  timestamp: string;
  result: 'success' | 'failure';
  tokensChanged: number;
  duration: string;
  errors: string;
  globalCount: number;
  semanticCount: number;
  componentCount: number;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Writes a build log entry to the Build Log Notion database.
 *
 * Each sync produces one row: timestamp, result, token counts, duration,
 * and any errors. The designer can open this table and see the full
 * history of every sync — when it ran, what happened, and what failed.
 */
export async function writeBuildLog(
  notion: Client,
  databaseId: string,
  entry: BuildLogEntry,
): Promise<void> {
  await notion.pages.create({
    parent: { database_id: databaseId },
    properties: {
      Timestamp: {
        title: [{ type: 'text', text: { content: entry.timestamp } }],
      },
      Result: {
        select: { name: entry.result },
      },
      'Tokens Changed': {
        number: entry.tokensChanged,
      },
      Duration: {
        rich_text: [{ type: 'text', text: { content: entry.duration } }],
      },
      Errors: {
        rich_text: entry.errors
          ? [{ type: 'text', text: { content: entry.errors } }]
          : [],
      },
      Global: {
        number: entry.globalCount,
      },
      Semantic: {
        number: entry.semanticCount,
      },
      Component: {
        number: entry.componentCount,
      },
    },
  });
}

/**
 * Creates a BuildLogEntry from a SyncResult.
 */
export function buildLogEntryFromResult(result: SyncResult): BuildLogEntry {
  const errorSummary = result.validationErrors.length > 0
    ? result.validationErrors.map((e) => `${e.token}: ${e.message}`).join('; ')
    : result.success
      ? ''
      : result.buildOutput.slice(0, 500);

  return {
    timestamp: result.timestamp,
    result: result.success ? 'success' : 'failure',
    tokensChanged: result.statusUpdates,
    duration: result.buildOutput.match(/in (\d+)ms/)?.[1]
      ? `${result.buildOutput.match(/in (\d+)ms/)?.[1]}ms`
      : 'N/A',
    errors: errorSummary,
    globalCount: result.globalCount,
    semanticCount: result.semanticCount,
    componentCount: result.componentCount,
  };
}