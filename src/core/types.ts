// ---------------------------------------------------------------------------
// Token types — normalized from Notion database rows
// ---------------------------------------------------------------------------

export interface GlobalToken {
  /** Notion page ID for this row — needed for write-back */
  pageId: string;
  /** Dot-notation path, e.g. "color.blue.500" */
  name: string;
  /** Raw value, e.g. "#217CF5" or "4px" */
  value: string;
  /** Token data type */
  type: 'color' | 'dimension' | 'fontFamily' | 'fontWeight' | 'shadow';
  /** Organizational category */
  category: string;
  /** Current sync status */
  status: 'synced' | 'modified' | 'error';
}

export interface SemanticToken {
  pageId: string;
  /** Dot-notation path, e.g. "color.text.primary" */
  name: string;
  /** Reference to a global token, e.g. "{color.gray.900}" */
  reference: string;
  /** Which theme this token belongs to */
  theme: 'light' | 'dark' | 'typography';
  status: 'synced' | 'modified' | 'error';
}

export interface ComponentToken {
  pageId: string;
  /** Dot-notation path, e.g. "button.primary.bg" */
  name: string;
  /** Reference to a semantic token, e.g. "{color.interactive.default}" */
  reference: string;
  /** Which component this token belongs to */
  component: string;
  status: 'synced' | 'modified' | 'error';
}

// ---------------------------------------------------------------------------
// Validation types
// ---------------------------------------------------------------------------

export interface ValidationError {
  /** Token name that failed validation */
  token: string;
  /** What went wrong */
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  tokenCount: number;
}

// ---------------------------------------------------------------------------
// Sync types
// ---------------------------------------------------------------------------

export interface SyncResult {
  success: boolean;
  globalCount: number;
  semanticCount: number;
  componentCount: number;
  totalTokens: number;
  validationErrors: ValidationError[];
  buildOutput: string;
  timestamp: string;
  statusUpdates: number;
}

export interface StatusUpdate {
  pageId: string;
  status: 'synced' | 'error';
  error?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SyncConfig {
  notionToken: string;
  globalDbId: string;
  semanticDbId: string;
  componentDbId: string;
  flintworkTokensPath: string;
}
