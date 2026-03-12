# flintwork-token-sync

MCP server that syncs design tokens between Notion databases and [flintwork](https://github.com/vmvenkatesh78/flintwork)'s token pipeline. Designers edit tokens in Notion, an AI agent validates and builds them into CSS.

## Architecture

```
Claude Desktop
    ├── Notion MCP (remote) — reads/writes Notion workspace
    └── flintwork-token-sync MCP (local) — validates, generates, builds
```

Claude orchestrates both MCP servers. It reads token state from Notion via Notion MCP, calls this server's tools to validate and build, and writes results back to Notion via Notion MCP.

## MCP Tools

| Tool | What it does |
|---|---|
| `sync_tokens` | Full pipeline: read → validate → generate JSON → build CSS → write status + build log |
| `validate_tokens` | Read and validate only — check for errors before committing |
| `diff_tokens` | Compare Notion state against JSON files on disk — preview what would change |
| `build_tokens` | Run the build pipeline on existing JSON files |
| `get_token_summary` | Read current state from Notion — counts, status breakdown, errors |

## Notion Databases

| Database | Rows | Purpose |
|---|---|---|
| Global Tokens | 93 | Raw palette values — colors, spacing, typography, shadows |
| Semantic Tokens | 96 | Intent mappings — light theme, dark theme, typography references |
| Component Tokens | 64 | Component bindings — button, dialog, tabs token references |
| Build Log | grows | Audit trail — every sync recorded with timestamp, result, errors |

253 tokens total across three token databases.

## Setup

### 1. Create Notion integration

Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations) and create an internal integration with read + insert + update permissions.

### 2. Create Notion databases

Create four databases in Notion: Global Tokens, Semantic Tokens, Component Tokens, Build Log. Connect the integration to each one. See [docs/reference.md](docs/reference.md) for exact column schemas.

### 3. Configure environment

```bash
cp .env.example .env
# Fill in your Notion token and all four database IDs
```

### 4. Install dependencies

```bash
npm install
```

### 5. Seed databases from existing tokens

```bash
npm run seed
```

This reads flintwork's JSON token files and populates all three token databases (253 tokens).

### 6. Connect to Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flintwork-token-sync": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/flintwork-token-sync/src/index.ts"],
      "env": {
        "NOTION_TOKEN": "ntn_your_token",
        "NOTION_GLOBAL_DB": "your_global_db_id",
        "NOTION_SEMANTIC_DB": "your_semantic_db_id",
        "NOTION_COMPONENT_DB": "your_component_db_id",
        "NOTION_BUILD_LOG_DB": "your_build_log_db_id",
        "FLINTWORK_TOKENS_PATH": "/absolute/path/to/flintwork/src/tokens"
      }
    }
  }
}
```

## CLI Usage

```bash
# Full sync: read → validate → generate → build → write status + build log
npm run cli sync

# Validate only
npm run cli validate

# Preview what would change
npm run cli diff

# Build only (no Notion interaction)
npm run cli build
```

## The Workflow

1. Designer opens Notion, changes a token reference (e.g., `color.interactive.default` from `{color.blue.500}` to `{color.blue.600}`)
2. User tells Claude: "Show me what changed" → Claude calls `diff_tokens`, shows the change
3. User tells Claude: "Sync my design tokens" → Claude calls `sync_tokens`
4. The tool reads all 253 tokens, validates values and references, generates JSON files, runs the build
5. Build succeeds → status updated to "synced" in Notion, build log entry written
6. Validation fails → error written to the specific token's Error column in Notion, build log records failure

## Tests

59 tests across three test files covering validation (token names, all value types, reference resolution, circular detection), JSON generation (file grouping, value formatting, all three tiers), and diff (added, removed, modified, unchanged, value normalization).

```bash
npm test
```

## License

MIT