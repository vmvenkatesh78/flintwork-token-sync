# flintwork-token-sync — Complete Reference

Everything about this project, explained as if teaching a junior developer who has never used Notion, MCP, or design tokens before.

---

## What This Project Does

Designers need to change colors, spacing, and typography in a design system. Developers need those changes to become real CSS. The gap between "designer changes a color" and "CSS updates" is where things break — manually copying hex values, mistyping references, forgetting to run builds.

This project eliminates that gap. A designer edits a token in a Notion table. An AI agent reads the change, validates it, generates the JSON files that the design system's build pipeline expects, runs the build, and writes "synced" or "error" back to Notion. The designer never leaves Notion. The developer never manually copies a value.

---

## The Pieces and How They Connect

```
Notion databases (3 tables — designer edits here)
        ↓ read via Notion MCP or Notion SDK
flintwork-token-sync (this project)
        ↓ validates → generates JSON → runs build
flintwork (the design system repo)
        ↓ build-tokens.ts produces CSS
dist/tokens/tokens.css (the output)
        ↓ status written back
Notion databases (updated with "synced" or "error")
```

There are three separate things working together:

**Notion** — the interface where designers see and edit tokens. Three database tables, one per token tier (global, semantic, component). Each row is one token.

**flintwork-token-sync** — this project. An MCP server + CLI tool that reads from Notion, validates the data, writes JSON files, triggers the build, and writes results back to Notion.

**flintwork** — the design system. Has a `build-tokens.ts` script that reads JSON token files and outputs CSS custom properties. This project writes those JSON files. flintwork's build script doesn't know or care where the JSON came from.

---

## Why Three Notion Databases

The design token system has three tiers. Each tier answers a different question.

**Global Tokens** — "What values exist?"

Raw palette values. A hex color, a pixel spacing value, a font size. These are facts, not decisions.

| Name | Value | Type | Category |
|---|---|---|---|
| color.blue.500 | #217CF5 | color | color |
| spacing.4 | 16px | dimension | spacing |
| fontSize.sm | 14px | dimension | fontSize |

A designer almost never edits these directly. If they do, it means the raw palette is changing — a rebrand, a new color added.

**Semantic Tokens** — "What is each value for?"

These map intent to global values. "Primary text color" points to a specific gray. "Interactive default" points to a specific blue. The same global value can be referenced by multiple semantic tokens — that's the point.

| Name | Reference | Theme |
|---|---|---|
| color.text.primary | {color.gray.900} | light |
| color.text.primary | {color.gray.50} | dark |
| color.interactive.default | {color.blue.500} | light |

This is where theme switching happens. The light theme maps `color.text.primary` to dark gray. The dark theme maps the same name to light gray. Components use the semantic name — they never know which gray they're getting.

**Component Tokens** — "What does each component need?"

These bind semantic tokens to specific component surfaces.

| Name | Reference | Component |
|---|---|---|
| button.primary.bg | {color.interactive.default} | button |
| button.primary.text | {color.text.inverse} | button |
| dialog.overlay.bg | {color.bg.inverse} | dialog |

A designer changing the button's primary color edits `button.primary.bg` — they don't need to know that it resolves through `color.interactive.default` to `color.blue.500` to `#217CF5`. They just change the reference.

---

## How the Sync Works — Step by Step

When someone runs `npm run cli sync` or Claude calls the `sync_tokens` MCP tool, here's exactly what happens:

**Step 1: Read from Notion.** The tool connects to Notion using the API token from `.env`. It queries all three databases using pagination (100 rows at a time) until every row is read. Each row becomes a typed object — `GlobalToken`, `SemanticToken`, or `ComponentToken` — with the Notion page ID preserved for write-back.

**Step 2: Validate.** Every token passes through validation checks:

- **Name format.** Must be dot-separated alphanumeric segments. `color.blue.500` is valid. `color..blue` is not. `color/blue` is not. Empty names are rejected.
- **Value format (global only).** Colors must be valid hex (`#RGB`, `#RRGGBB`, `#RRGGBBAA`), `transparent`, or `none`. Dimensions must have units (`px`, `rem`, `em`, `%`) or be unitless numbers (valid for `line-height`). Font weights must be numeric. Font families must be non-empty.
- **Reference resolution.** Semantic tokens must reference global token names that exist. Component tokens must reference semantic or global token names that exist. `{color.blue.500}` is valid if `color.blue.500` exists in the global database. `{color.purple.500}` is invalid if that token doesn't exist.
- **Circular references.** Token A referencing Token B which references Token A is detected and rejected. Uses iterative path tracking, not recursion.

If any validation fails, the tool writes "error" status and the error message to the specific Notion row that failed, then stops. The designer sees exactly which token has the problem and what's wrong.

**Step 3: Generate JSON.** The validated tokens are converted into the JSON file format that flintwork's build script expects. The structure mirrors what you'd write by hand:

```json
{
  "color": {
    "blue": {
      "500": { "$value": "#217CF5" }
    }
  }
}
```

Global tokens are grouped by category into files: colors go to `colors.json`, spacing to `spacing.json`, font-related tokens merge into `typography.json`. Semantic tokens split by theme: `light.json` and `dark.json`. Component tokens split by component: `button.json`, `dialog.json`, `tabs.json`.

Files are written to flintwork's `src/tokens/` directory, organized into `global/`, `semantic/`, and `component/` subdirectories.

**Step 4: Build.** The tool runs flintwork's `build-tokens.ts` script using `execSync`. This script reads the JSON files, resolves all cross-tier references, and outputs CSS custom properties in `dist/tokens/tokens.css`. The sync tool captures the build output (token counts, file paths) and checks for success or failure.

**Step 5: Write status back.** If everything succeeded, every Notion row gets:
- Status → "synced"
- Last Synced → current timestamp
- Error → cleared

This is done sequentially with a 350ms delay between rows to respect Notion's rate limit of ~3 requests per second. However, the sync is optimized: it only updates rows whose status actually changed. If a designer modifies one token, only that one row gets written back — not all 217. On the first sync after seeding (when all rows are already "synced"), zero writes happen. This optimization is critical for the MCP server, where tool calls have a timeout — writing all 217 rows would take ~76 seconds and exceed the limit.

---

## The Two Interfaces

The same core logic powers two interfaces. Neither contains business logic — they're just different ways to invoke the same functions.

### MCP Server

The primary interface. An AI agent (Claude Desktop) connects to this server and calls tools.

```
Claude Desktop
    ├── Notion MCP (remote) — reads/writes Notion workspace
    └── flintwork-token-sync MCP (local) — this server
```

Four tools are available:

| Tool | What it does | When to use |
|---|---|---|
| `sync_tokens` | Full pipeline: read → validate → generate → build → write status | "Sync my design tokens" |
| `validate_tokens` | Read and validate only | "Check if my tokens have any errors" |
| `build_tokens` | Run the build on existing JSON files | "Rebuild the CSS from current JSON files" |
| `get_token_summary` | Read current state from Notion | "What's the status of my tokens?" |

The server communicates over stdio (standard input/output). Claude Desktop starts the server process and sends/receives JSON messages through it.

### CLI

The standalone interface. Run directly from the terminal without an AI agent.

```bash
npm run cli sync       # Full pipeline
npm run cli validate   # Validate only
npm run cli build      # Build only
```

Same functions, same output, no MCP dependency. Useful for CI pipelines, quick checks, and debugging.

---

## Project Structure

```
flintwork-token-sync/
├── src/
│   ├── core/                      ← Business logic. No MCP, no Notion SDK imports.
│   │   ├── types.ts               ← All TypeScript types (tokens, results, config)
│   │   ├── notion-client.ts       ← Notion read/write via @notionhq/client
│   │   ├── validate.ts            ← Token validation (hex, refs, circular, names)
│   │   ├── validate.test.ts       ← 22 tests for validation
│   │   ├── generate-json.ts       ← Notion data → flintwork JSON files
│   │   ├── generate-json.test.ts  ← 8 tests for JSON generation
│   │   ├── build.ts               ← Runs flintwork's build-tokens.ts
│   │   └── sync.ts                ← Orchestrator — single source of truth for the pipeline
│   ├── mcp-server/
│   │   └── server.ts              ← MCP tool definitions (thin wrappers around core/)
│   ├── index.ts                   ← MCP server entry point
│   ├── cli.ts                     ← CLI entry point (thin wrapper around core/)
│   └── seed.ts                    ← Populates Notion from existing JSON files
├── docs/
│   └── decisions/
│       └── decisions.md           ← Architecture Decision Records
├── .env.example                   ← Environment variable template
├── .env                           ← Your actual config (gitignored)
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

**Why `core/` is separate from `mcp-server/`.** The core directory contains pure business logic — validation, JSON generation, build execution. It doesn't know about MCP. It doesn't know about CLI argument parsing. It just takes data in and produces results. This means:

- The MCP server calls `sync()` from `core/sync.ts`
- The CLI calls `sync()` from `core/sync.ts`
- Tests call `validateTokens()` and `generateTokenFiles()` from `core/` directly

One function, two interfaces, same behavior. If you fix a bug in `validate.ts`, both the MCP server and CLI get the fix automatically.

---

## How to Set Up From Scratch

### Prerequisites

- Node.js 20 or later
- A Notion account
- The flintwork repo cloned alongside this repo

### Step 1: Create the Notion Integration

Go to https://www.notion.so/profile/integrations. Click "New integration."

- Name: `flintwork-token-sync`
- Capabilities: Read content, Insert content, Update content
- Do NOT enable: Comment, Read comments

Copy the integration token. It starts with `ntn_`. Keep it private.

### Step 2: Create the Notion Databases

Create three full-page table databases in Notion:

**Global Tokens:**

| Column | Type | Select Options |
|---|---|---|
| Name | Title | — |
| Value | Text | — |
| Type | Select | color, dimension, fontFamily, fontWeight, shadow |
| Category | Select | color, spacing, radii, shadow, fontSize, fontWeight, fontFamily, lineHeight |
| Status | Select | synced, modified, error |
| Last Synced | Date | — |
| Error | Text | — |

**Semantic Tokens:**

| Column | Type | Select Options |
|---|---|---|
| Name | Title | — |
| Reference | Text | — |
| Theme | Select | light, dark |
| Status | Select | synced, modified, error |
| Last Synced | Date | — |
| Error | Text | — |

**Component Tokens:**

| Column | Type | Select Options |
|---|---|---|
| Name | Title | — |
| Reference | Text | — |
| Component | Select | button, dialog, tabs |
| Status | Select | synced, modified, error |
| Last Synced | Date | — |
| Error | Text | — |

After creating each database, connect the integration: click `...` (top right) → Connections → search for `flintwork-token-sync` → Confirm.

### Step 3: Get the Database IDs

Open each database in Notion. Click "Share" → "Copy link." The URL looks like:

```
https://www.notion.so/your-workspace/31cc91e6f0c080a4aa0df63bf96bade4?v=...
```

The 32-character hex string between the last `/` and `?v=` is the database ID. You need one from each of the three databases.

### Step 4: Configure the Environment

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```
NOTION_TOKEN=ntn_your_actual_token
NOTION_GLOBAL_DB=your_32_char_global_db_id
NOTION_SEMANTIC_DB=your_32_char_semantic_db_id
NOTION_COMPONENT_DB=your_32_char_component_db_id
FLINTWORK_TOKENS_PATH=../flintwork/src/tokens
```

### Step 5: Install and Seed

```bash
npm install
npm run seed
```

The seed script reads flintwork's existing JSON token files and creates corresponding rows in Notion. Each token becomes a row with the correct name, value/reference, type, category, and "synced" status. This takes a few minutes due to Notion's rate limit.

### Step 6: Verify

```bash
npm run cli validate
```

Should print: "All 217 tokens are valid."

```bash
npm run cli sync
```

Should read from Notion, validate, generate JSON, build CSS, and write "synced" status back to any rows that changed.

---

## How to Connect to Claude Desktop

### Step 1: Find the Config File

On macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

If the file doesn't exist, create it.

### Step 2: Add Both MCP Servers

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

Replace all paths and tokens with your actual values. Paths must be absolute, not relative.

### Step 3: Restart Claude Desktop

Quit and reopen. The MCP servers will appear in the tool list.

### Step 4: Test

Tell Claude: "Get my token summary" — it should call `get_token_summary` and show the count of global, semantic, and component tokens.

Tell Claude: "Sync my design tokens" — it should call `sync_tokens` and report the full pipeline result.

---

## The Workflow a Designer Uses

1. Open Notion. Go to the Semantic Tokens database.
2. Find `color.interactive.default`. Change the Reference from `{color.blue.500}` to `{color.blue.600}`.
3. Change the Status to "modified" (optional — the sync tool validates regardless of status).
4. Tell Claude (or run the CLI): "Sync design tokens."
5. The tool reads the change, validates it (does `color.blue.600` exist?), generates new JSON, builds CSS.
6. In Notion, the row updates to Status: "synced", Last Synced: just now, Error: empty.
7. In flintwork's `dist/tokens/tokens.css`, `--fw-color-interactive-default` now has the new hex value.

If the designer typos the reference — `{color.blue.999}` (doesn't exist):

1. The tool reads the change, validates it, finds the broken reference.
2. In Notion, the row updates to Status: "error", Error: "Unresolved reference: {color.blue.999} does not match any known token."
3. No JSON files are generated. No build runs. The current working CSS is untouched.
4. The designer sees the error, fixes the reference, syncs again.

---

## Testing

30 tests across two test files. All test pure functions in `core/` — no Notion API calls, no MCP dependency.

```bash
npm test
```

**validate.test.ts — 22 tests:**

- Token name validation (7): valid names, empty, double dots, leading/trailing dots, slashes, hyphens
- Color validation (8): 3/6/8-digit hex, transparent, none, invalid hex, 5-digit hex, empty
- Dimension validation (6): px, rem, unitless, none, shadow-as-dimension, invalid
- Font weight (2): numeric, non-numeric
- Shadow (2): complex values, none
- Reference validation (4): valid semantic→global, unresolved, component→semantic, plain values
- Circular reference detection (2): detected, not detected
- Token count (1): correct total across tiers

**generate-json.test.ts — 8 tests:**

- Global files (5): colors.json, spacing.json, typography merge, font weight as number, font family as array
- Semantic files (2): light/dark creation, references stored as strings
- Component files (1): separate files per component

---

## Key Technical Decisions

Documented in detail in `docs/decisions/decisions.md`. Summary:

1. **MCP server as primary interface** — not CLI-first with MCP wrapper. The hackathon evaluates MCP usage depth.
2. **Separate repo from flintwork** — infrastructure tooling, not library code. Only coupling is a file path.
3. **Three Notion databases** — one per token tier, matching the three-tier architecture.
4. **Bidirectional sync** — status written back to each Notion row, not just logged to console.
5. **Optimized write-back** — only update rows whose status changed. Discovered when full 217-row write-back exceeded MCP tool call timeout.

---

## What the Seed Script Does

`npm run seed` reads flintwork's JSON token files and creates Notion rows from them. It's a one-time setup step — you run it once to populate the databases, then the sync tool takes over.

The seed script handles type inference: hex values become "color", px/rem values become "dimension", comma-separated strings become "fontFamily", numbers become "fontWeight". It also handles category inference from file names: `colors.json` → "color", `spacing.json` → "spacing", `typography.json` → inferred per-token from the path (fontSize, fontWeight, fontFamily, lineHeight).

Rate limiting: Notion allows ~3 requests per second. The seed script waits 350ms between each row creation. For 217 tokens, this takes about 76 seconds.

---

## Common Issues

**"Missing required environment variable"** — Your `.env` file is missing or incomplete. Copy `.env.example` to `.env` and fill in all values.

**"Could not find database with ID..."** — The database ID in `.env` is wrong, or the integration isn't connected to that database. Open the database in Notion → `...` → Connections → verify the integration is listed.

**"Unresolved reference"** — A semantic token references a global token name that doesn't exist, or a component token references a semantic token name that doesn't exist. Check the spelling in the Reference column.

**Rate limit errors from Notion** — The tool waits 350ms between writes. If you still hit limits, increase the delay in `notion-client.ts` (the `writeStatusBatch` function).

**Build fails after successful validation** — The JSON files were generated but flintwork's build script found an issue. Check the build output for the specific error. Common cause: a reference in the generated JSON doesn't match a token path in another generated file (the Notion data is self-consistent but the generated file structure doesn't match what the build script expects).