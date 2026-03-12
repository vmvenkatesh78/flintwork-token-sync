import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createNotionClient } from '../core/notion-client.js';
import { validateTokens } from '../core/validate.js';
import { runTokenBuild } from '../core/build.js';
import { sync, readAllTokens } from '../core/sync.js';
import { diffTokens } from '../core/diff.js';
import type { SyncConfig } from '../core/types.js';

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Creates and configures the MCP server with all token sync tools.
 *
 * Five tools exposed to Claude:
 *
 * 1. `sync_tokens`          — full pipeline via shared sync()
 * 2. `validate_tokens`      — read + validate, no file generation
 * 3. `build_tokens`         — run build on existing JSON files
 * 4. `get_token_summary`    — read current state from Notion
 * 5. `diff_tokens`          — compare Notion state against JSON on disk
 */
export function createMcpServer(config: SyncConfig): McpServer {
  const server = new McpServer({
    name: 'flintwork-token-sync',
    version: '0.1.0',
  });

  const notion = createNotionClient(config.notionToken);

  // -----------------------------------------------------------------------
  // Tool 1: sync_tokens — full pipeline
  // -----------------------------------------------------------------------

  server.tool(
    'sync_tokens',
    'Reads design tokens from Notion databases, validates them, generates JSON files for flintwork, runs the token build pipeline, and writes sync status back to Notion. This is the complete sync workflow.',
    {},
    async () => {
      try {
        const result = await sync(notion, config);

        if (!result.success && result.validationErrors.length > 0) {
          return {
            content: [{
              type: 'text' as const,
              text: [
                `Validation failed. ${result.validationErrors.length} error(s) found across ${result.totalTokens} tokens.`,
                ``,
                `Errors:`,
                ...result.validationErrors.map((e) => `  • ${e.token}: ${e.message}`),
                ``,
                `Updated ${result.statusUpdates} error rows in Notion.`,
              ].join('\n'),
            }],
          };
        }

        if (!result.success) {
          return {
            content: [{
              type: 'text' as const,
              text: `Token build failed.\n\nBuild output:\n${result.buildOutput}`,
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: [
              `Token sync complete.`,
              ``,
              `Read: ${result.totalTokens} tokens (${result.globalCount} global, ${result.semanticCount} semantic, ${result.componentCount} component)`,
              `Validated: ${result.totalTokens} tokens, 0 errors`,
              `Build: success`,
              `Status: updated ${result.statusUpdates} rows in Notion`,
              ``,
              `Build output:`,
              result.buildOutput,
            ].join('\n'),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Sync failed with error: ${message}`,
          }],
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Tool 2: validate_tokens — read and validate only
  // -----------------------------------------------------------------------

  server.tool(
    'validate_tokens',
    'Reads design tokens from Notion and validates them without generating files or building. Use this to check for errors before running a full sync.',
    {},
    async () => {
      try {
        const tokens = await readAllTokens(notion, config);
        const validation = validateTokens(tokens.global, tokens.semantic, tokens.component);

        if (validation.valid) {
          return {
            content: [{
              type: 'text' as const,
              text: `All ${validation.tokenCount} tokens are valid. Ready to sync.`,
            }],
          };
        }

        return {
          content: [{
            type: 'text' as const,
            text: [
              `Validation found ${validation.errors.length} error(s) across ${validation.tokenCount} tokens:`,
              ``,
              ...validation.errors.map((e) => `  • ${e.token}: ${e.message}`),
            ].join('\n'),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Validation failed with error: ${message}`,
          }],
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Tool 3: build_tokens — run build only (no Notion interaction)
  // -----------------------------------------------------------------------

  server.tool(
    'build_tokens',
    'Runs flintwork\'s token build pipeline on the existing JSON files. Does not read from Notion — use this after manually editing token JSON files.',
    {},
    async () => {
      const build = runTokenBuild(config.flintworkTokensPath);

      return {
        content: [{
          type: 'text' as const,
          text: build.success
            ? `Build succeeded in ${build.duration}ms.\n\n${build.output}`
            : `Build failed.\n\n${build.output}`,
        }],
      };
    },
  );

  // -----------------------------------------------------------------------
  // Tool 4: get_token_summary — current state from Notion
  // -----------------------------------------------------------------------

  server.tool(
    'get_token_summary',
    'Reads the current state of all token databases from Notion and returns a summary including counts, status breakdown, and any existing errors.',
    {},
    async () => {
      try {
        const tokens = await readAllTokens(notion, config);
        const allTokens = [...tokens.global, ...tokens.semantic, ...tokens.component];
        const synced = allTokens.filter((t) => t.status === 'synced').length;
        const modified = allTokens.filter((t) => t.status === 'modified').length;
        const errored = allTokens.filter((t) => t.status === 'error').length;

        const lines = [
          `Token Summary`,
          ``,
          `Total: ${allTokens.length} tokens`,
          `  Global:    ${tokens.global.length}`,
          `  Semantic:  ${tokens.semantic.length}`,
          `  Component: ${tokens.component.length}`,
          ``,
          `Status:`,
          `  Synced:   ${synced}`,
          `  Modified: ${modified}`,
          `  Errors:   ${errored}`,
        ];

        if (errored > 0) {
          lines.push(``, `Tokens with errors:`);
          for (const token of allTokens) {
            if (token.status === 'error') {
              lines.push(`  • ${token.name}`);
            }
          }
        }

        if (modified > 0) {
          lines.push(``, `Tokens pending sync:`);
          for (const token of allTokens) {
            if (token.status === 'modified') {
              lines.push(`  • ${token.name}`);
            }
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Failed to read token summary: ${message}`,
          }],
        };
      }
    },
  );

  // -----------------------------------------------------------------------
  // Tool 5: diff_tokens — compare Notion state against disk
  // -----------------------------------------------------------------------

  server.tool(
    'diff_tokens',
    'Compares current Notion token state against the JSON files on disk. Shows what would change if you sync: added tokens, removed tokens, and modified values. Use this to preview changes before running a full sync.',
    {},
    async () => {
      try {
        const tokens = await readAllTokens(notion, config);
        const diff = diffTokens(
          tokens.global,
          tokens.semantic,
          tokens.component,
          config.flintworkTokensPath,
        );

        if (diff.changes.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No differences found. Notion and disk are in sync (${diff.total} tokens compared).`,
            }],
          };
        }

        const lines = [
          `Token Diff: ${diff.changes.length} change(s) found`,
          ``,
          `  Added:     ${diff.added}`,
          `  Removed:   ${diff.removed}`,
          `  Modified:  ${diff.modified}`,
          `  Unchanged: ${diff.unchanged}`,
          ``,
        ];

        for (const change of diff.changes) {
          const tag = change.change.toUpperCase().padEnd(8);
          const tier = `[${change.tier}]`.padEnd(12);

          if (change.change === 'added') {
            lines.push(`  ${tag} ${tier} ${change.name}: ${change.after}`);
          } else if (change.change === 'removed') {
            lines.push(`  ${tag} ${tier} ${change.name}: ${change.before}`);
          } else {
            lines.push(`  ${tag} ${tier} ${change.name}: ${change.before} → ${change.after}`);
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: `Diff failed with error: ${message}`,
          }],
        };
      }
    },
  );

  return server;
}