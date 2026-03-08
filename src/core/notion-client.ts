import { Client } from '@notionhq/client';
import type {
  GlobalToken,
  SemanticToken,
  ComponentToken,
  StatusUpdate,
  SyncConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Notion property extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a plain text value from a Notion title property.
 * Returns empty string if the property is missing or has no content.
 */
function getTitle(properties: Record<string, unknown>, key: string): string {
  const prop = properties[key] as { type?: string; title?: Array<{ plain_text: string }> } | undefined;
  if (prop?.type !== 'title' || !prop.title) return '';
  return prop.title.map((t) => t.plain_text).join('') || '';
}

/**
 * Extracts a plain text value from a Notion rich_text property.
 */
function getRichText(properties: Record<string, unknown>, key: string): string {
  const prop = properties[key] as { type?: string; rich_text?: Array<{ plain_text: string }> } | undefined;
  if (prop?.type !== 'rich_text' || !prop.rich_text) return '';
  return prop.rich_text.map((t) => t.plain_text).join('') || '';
}

/**
 * Extracts a select value from a Notion select property.
 */
function getSelect(properties: Record<string, unknown>, key: string): string {
  const prop = properties[key] as { type?: string; select?: { name: string } | null } | undefined;
  if (prop?.type !== 'select' || !prop.select) return '';
  return prop.select.name || '';
}

// ---------------------------------------------------------------------------
// Read functions
// ---------------------------------------------------------------------------

/**
 * Reads all rows from a Notion database, handling pagination.
 * Returns raw Notion page objects.
 */
async function queryAllPages(client: Client, databaseId: string): Promise<Array<Record<string, unknown>>> {
  const pages: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;

  do {
    const response = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of response.results) {
      pages.push(page as Record<string, unknown>);
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return pages;
}

/**
 * Reads all global tokens from the Notion database.
 */
export async function readGlobalTokens(client: Client, databaseId: string): Promise<GlobalToken[]> {
  const pages = await queryAllPages(client, databaseId);

  return pages
    .map((page) => {
      const props = (page as { properties: Record<string, unknown> }).properties;
      const name = getTitle(props, 'Name');
      if (!name) return null;

      return {
        pageId: (page as { id: string }).id,
        name,
        value: getRichText(props, 'Value'),
        type: (getSelect(props, 'Type') || 'color') as GlobalToken['type'],
        category: getSelect(props, 'Category'),
        status: (getSelect(props, 'Status') || 'modified') as GlobalToken['status'],
      };
    })
    .filter((t): t is GlobalToken => t !== null);
}

/**
 * Reads all semantic tokens from the Notion database.
 */
export async function readSemanticTokens(client: Client, databaseId: string): Promise<SemanticToken[]> {
  const pages = await queryAllPages(client, databaseId);

  return pages
    .map((page) => {
      const props = (page as { properties: Record<string, unknown> }).properties;
      const name = getTitle(props, 'Name');
      if (!name) return null;

      return {
        pageId: (page as { id: string }).id,
        name,
        reference: getRichText(props, 'Reference'),
        theme: (getSelect(props, 'Theme') || 'light') as SemanticToken['theme'],
        status: (getSelect(props, 'Status') || 'modified') as SemanticToken['status'],
      };
    })
    .filter((t): t is SemanticToken => t !== null);
}

/**
 * Reads all component tokens from the Notion database.
 */
export async function readComponentTokens(client: Client, databaseId: string): Promise<ComponentToken[]> {
  const pages = await queryAllPages(client, databaseId);

  return pages
    .map((page) => {
      const props = (page as { properties: Record<string, unknown> }).properties;
      const name = getTitle(props, 'Name');
      if (!name) return null;

      return {
        pageId: (page as { id: string }).id,
        name,
        reference: getRichText(props, 'Reference'),
        component: getSelect(props, 'Component'),
        status: (getSelect(props, 'Status') || 'modified') as ComponentToken['status'],
      };
    })
    .filter((t): t is ComponentToken => t !== null);
}

// ---------------------------------------------------------------------------
// Write functions
// ---------------------------------------------------------------------------

/**
 * Updates a Notion page's Status, Last Synced, and Error properties.
 */
export async function writeStatus(client: Client, update: StatusUpdate): Promise<void> {
  await client.pages.update({
    page_id: update.pageId,
    properties: {
      Status: {
        select: { name: update.status },
      },
      'Last Synced': {
        date: { start: update.timestamp },
      },
      Error: {
        rich_text: update.error
          ? [{ type: 'text' as const, text: { content: update.error } }]
          : [],
      },
    },
  });
}

/**
 * Batch updates multiple pages with their sync status.
 * Processes sequentially to avoid Notion rate limits.
 */
export async function writeStatusBatch(client: Client, updates: StatusUpdate[]): Promise<void> {
  for (const update of updates) {
    await writeStatus(client, update);
    // Small delay to respect Notion's rate limit (3 requests/second)
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createNotionClient(token: string): Client {
  return new Client({ auth: token });
}
