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
| `sync_tokens` | Full pipeline: read → validate → generate JSON → build CSS → write status back |
| `validate_tokens` | Read and validate only — check for errors before committing |
| `build_tokens` | Run the build pipeline on existing JSON files |
| `get_token_summary` | Read current state from Notion — counts, status breakdown, errors |

## Setup

### 1. Create Notion integration

Go to [notion.so/profile/integrations](https://www.notion.so/profile/integrations) and create an internal integration with read + insert + update permissions.

### 2. Create Notion databases

Create three databases in Notion: Global Tokens, Semantic Tokens, Component Tokens. Connect the integration to each one.

### 3. Configure environment

```bash
cp .env.example .env
# Fill in your Notion token and database IDs
```

### 4. Install dependencies

```bash
npm install
```

### 5. Seed databases from existing tokens

```bash
npm run seed
```

This reads flintwork's JSON token files and populates the Notion databases.

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
        "FLINTWORK_TOKENS_PATH": "/absolute/path/to/flintwork/src/tokens"
      }
    },
    "notionMCP": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.notion.com/mcp"]
    }
  }
}
```

## CLI Usage

```bash
# Full sync: read → validate → generate → build → write status
npm run cli sync

# Validate only
npm run cli validate

# Build only (no Notion interaction)
npm run cli build
```

## The Workflow

1. Designer opens Notion, changes a token value (e.g., `color.interactive.default` from `#217CF5` to `#2563EB`)
2. User tells Claude: "Sync design tokens from Notion"
3. Claude calls `sync_tokens` on this MCP server
4. The tool reads all token databases, validates values, generates JSON files, runs the build
5. Build succeeds → status updated to "synced" in Notion
6. Build fails → validation errors written to the Error column in Notion

## License

MIT
