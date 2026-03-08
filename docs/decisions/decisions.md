# ADR-001: MCP Server as Primary Interface

## Status
Accepted

## Context
The token sync tool needs two interfaces: one for AI agent orchestration (the hackathon demo) and one for standalone CLI use. The question is which is the primary interface.

## Decision
The MCP server is the primary interface. The CLI is a thin wrapper that calls the same core functions. The `core/` directory contains all business logic with no MCP or Notion SDK dependency. Both `mcp-server/server.ts` and `cli.ts` call into `core/sync.ts`.

## Alternatives Considered
- **CLI-first with MCP wrapper.** The CLI would be the engine and MCP would invoke it via shell exec. Rejected because MCP usage would be superficial — the hackathon judges evaluate MCP integration depth.
- **MCP-only, no CLI.** Would work for the demo but limits usability. A CI pipeline can't connect to an MCP server — it needs a CLI.

## Consequences
- The shared `sync()` function in `core/sync.ts` is the single source of truth for the pipeline. Changes propagate to both interfaces automatically.
- The MCP server's tools are thin wrappers around core functions — they format results as MCP text responses but contain no business logic.

---

# ADR-002: Separate Repository from Flintwork

## Status
Accepted

## Context
The sync tool operates on flintwork's token files. It could live inside the flintwork repo or in its own repo.

## Decision
Separate repository. The sync tool is infrastructure tooling that operates ON flintwork, not a part of flintwork's library output. A consumer installing `flintwork` from npm doesn't need the sync tool.

## Alternatives Considered
- **Inside flintwork as a workspace package.** Would keep everything together but adds the sync tool's dependencies (Notion SDK, MCP SDK) to flintwork's dependency tree. Consumers who don't use Notion would pay the install cost.
- **Inside flintwork as a script in `src/scripts/`.** Too tightly coupled. The sync tool has its own dependencies, tests, and lifecycle.

## Consequences
- The only coupling between the two repos is a file path: `--output ../flintwork/src/tokens`. The sync tool writes JSON files. Flintwork's build script reads them. Neither imports from the other.
- Both repos can be versioned, tested, and published independently.

---

# ADR-003: Three Notion Databases Mirroring Three Token Tiers

## Status
Accepted

## Context
The token system has three tiers: global, semantic, component. The Notion representation needs to map to these tiers.

## Decision
Three separate Notion databases, one per tier. Each has tier-specific columns (Global has Value and Type, Semantic has Reference and Theme, Component has Reference and Component).

## Alternatives Considered
- **One database with a Tier column.** Simpler setup but mixes different column needs. A global token has a Value (raw hex), a semantic token has a Reference (to another token). One table can't enforce both schemas without nullable columns everywhere.
- **One database per file (colors.json, spacing.json, etc.).** Too granular. 10+ databases to manage in Notion. The three-tier split matches the architecture — the designer thinks in tiers, not in files.

## Consequences
- The seed script reads flintwork's JSON files and writes to the correct database based on directory (`global/` → Global DB, `semantic/` → Semantic DB, `component/` → Component DB).
- The generate script reverses this: reads from each database and writes to the correct directory.
- A designer can change a semantic token's reference without seeing global raw values they shouldn't touch.

---

# ADR-004: Bidirectional Sync with Status Write-Back

## Status
Accepted

## Context
Most Notion integrations are unidirectional — read from Notion, do something. The sync tool needs to communicate results back to the designer.

## Decision
After every sync, the tool writes back to each Notion row: `Status` (synced/error), `Last Synced` (timestamp), and `Error` (validation message if failed). The designer sees the result without leaving Notion.

## Alternatives Considered
- **Write to a separate Build Log database.** Adds a fourth database that the designer has to check separately. The status on the token row itself is more immediate.
- **No write-back — just CLI output.** The designer never sees the result unless someone tells them. Defeats the purpose of Notion as the interface.

## Consequences
- The sync only writes back to rows whose status actually changed — tokens already marked "synced" are skipped. This was discovered when the initial implementation tried to update all 217 rows (~76 seconds at 350ms/row), which exceeded Claude Desktop's MCP tool call timeout. The optimization means a typical sync (one token changed) writes back 1 row instead of 217.
- Validation errors are written to the Error column of the specific token that failed — the designer sees exactly which token has the problem and what's wrong.

---

# ADR-005: Optimized Write-Back — Only Update Changed Rows

## Status
Accepted

## Context
The initial implementation wrote "synced" status to every Notion row on every sync — all 217 tokens. At 350ms per row (Notion's rate limit), this took ~76 seconds. Claude Desktop's MCP tool calls have a timeout shorter than this, causing the sync to silently fail when invoked via MCP.

## Decision
`writeSyncSuccess` filters tokens by status before writing. Only rows where `status !== 'synced'` are updated. A typical sync after one designer edit writes back 1 row, not 217.

## Alternatives Considered
- **Increase the rate limit delay.** Would make the problem worse, not better.
- **Batch Notion API calls.** The Notion API does not support batch updates — each page update is a separate HTTP request.
- **Run write-back in background after returning the MCP response.** Would require the MCP tool to return "sync complete" before status is actually written. The designer might check Notion and see stale status. Rejected for correctness.

## Consequences
- First sync after seeding (all rows already "synced") writes 0 rows — instant.
- Sync after one designer edit writes 1 row — ~350ms.
- Sync after validation failure writes only the errored rows.
- The CLI is unaffected — it had no timeout constraint — but benefits from the same optimization.