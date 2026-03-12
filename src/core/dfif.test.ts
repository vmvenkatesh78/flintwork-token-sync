import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { diffTokens } from './diff.js';
import type { GlobalToken, SemanticToken, ComponentToken } from './types.js';

// ---------------------------------------------------------------------------
// Test directory management
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'flintwork-diff-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function writeTokenJson(relativePath: string, data: Record<string, unknown>): void {
  const filePath = join(testDir, relativePath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGlobal(overrides: Partial<GlobalToken> = {}): GlobalToken {
  return {
    pageId: 'page-1',
    name: 'color.blue.500',
    value: '#217CF5',
    type: 'color',
    category: 'color',
    status: 'synced',
    ...overrides,
  };
}

function makeSemantic(overrides: Partial<SemanticToken> = {}): SemanticToken {
  return {
    pageId: 'page-2',
    name: 'color.text.primary',
    reference: '{color.gray.900}',
    theme: 'light',
    status: 'synced',
    ...overrides,
  };
}

function makeComponent(overrides: Partial<ComponentToken> = {}): ComponentToken {
  return {
    pageId: 'page-3',
    name: 'button.primary.bg',
    reference: '{color.interactive.default}',
    component: 'button',
    status: 'synced',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// No changes
// ---------------------------------------------------------------------------

describe('no changes', () => {
  it('reports zero changes when Notion matches disk', () => {
    writeTokenJson('global/colors.json', {
      color: { blue: { '500': { $value: '#217CF5' } } },
    });

    const result = diffTokens(
      [makeGlobal({ name: 'color.blue.500', value: '#217CF5' })],
      [],
      [],
      testDir,
    );

    expect(result.changes).toHaveLength(0);
    expect(result.unchanged).toBe(1);
    expect(result.modified).toBe(0);
  });

  it('reports zero changes when disk directory does not exist', () => {
    const result = diffTokens([], [], [], testDir);

    expect(result.changes).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Modified tokens
// ---------------------------------------------------------------------------

describe('modified tokens', () => {
  it('detects modified global token value', () => {
    writeTokenJson('global/colors.json', {
      color: { blue: { '500': { $value: '#217CF5' } } },
    });

    const result = diffTokens(
      [makeGlobal({ name: 'color.blue.500', value: '#2563EB' })],
      [],
      [],
      testDir,
    );

    expect(result.modified).toBe(1);
    expect(result.changes[0]?.change).toBe('modified');
    expect(result.changes[0]?.before).toBe('#217CF5');
    expect(result.changes[0]?.after).toBe('#2563EB');
  });

  it('detects modified semantic token reference', () => {
    writeTokenJson('semantic/light.json', {
      color: { text: { primary: { $value: '{color.gray.900}' } } },
    });

    const result = diffTokens(
      [],
      [makeSemantic({ name: 'color.text.primary', reference: '{color.gray.800}' })],
      [],
      testDir,
    );

    expect(result.modified).toBe(1);
    expect(result.changes[0]?.before).toBe('{color.gray.900}');
    expect(result.changes[0]?.after).toBe('{color.gray.800}');
  });

  it('detects modified component token reference', () => {
    writeTokenJson('component/button.json', {
      button: { primary: { bg: { $value: '{color.interactive.default}' } } },
    });

    const result = diffTokens(
      [],
      [],
      [makeComponent({ name: 'button.primary.bg', reference: '{color.blue.600}' })],
      testDir,
    );

    expect(result.modified).toBe(1);
    expect(result.changes[0]?.tier).toBe('component');
  });
});

// ---------------------------------------------------------------------------
// Added tokens
// ---------------------------------------------------------------------------

describe('added tokens', () => {
  it('detects token in Notion but not on disk', () => {
    // Empty disk — no global directory
    const result = diffTokens(
      [makeGlobal({ name: 'color.purple.500', value: '#7C3AED' })],
      [],
      [],
      testDir,
    );

    expect(result.added).toBe(1);
    expect(result.changes[0]?.change).toBe('added');
    expect(result.changes[0]?.after).toBe('#7C3AED');
    expect(result.changes[0]?.before).toBeUndefined();
  });

  it('detects new token added alongside existing ones', () => {
    writeTokenJson('global/colors.json', {
      color: { blue: { '500': { $value: '#217CF5' } } },
    });

    const result = diffTokens(
      [
        makeGlobal({ name: 'color.blue.500', value: '#217CF5' }),
        makeGlobal({ name: 'color.blue.600', value: '#1A4AC8' }),
      ],
      [],
      [],
      testDir,
    );

    expect(result.added).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(result.changes[0]?.name).toBe('color.blue.600');
  });
});

// ---------------------------------------------------------------------------
// Removed tokens
// ---------------------------------------------------------------------------

describe('removed tokens', () => {
  it('detects token on disk but not in Notion', () => {
    writeTokenJson('global/colors.json', {
      color: {
        blue: { '500': { $value: '#217CF5' } },
        red: { '500': { $value: '#D92D20' } },
      },
    });

    const result = diffTokens(
      [makeGlobal({ name: 'color.blue.500', value: '#217CF5' })],
      [],
      [],
      testDir,
    );

    expect(result.removed).toBe(1);
    expect(result.changes.find((c) => c.change === 'removed')?.name).toBe('color.red.500');
  });
});

// ---------------------------------------------------------------------------
// Multiple tiers
// ---------------------------------------------------------------------------

describe('multiple tiers', () => {
  it('diffs all three tiers simultaneously', () => {
    writeTokenJson('global/colors.json', {
      color: { blue: { '500': { $value: '#217CF5' } } },
    });
    writeTokenJson('semantic/light.json', {
      color: { text: { primary: { $value: '{color.gray.900}' } } },
    });
    writeTokenJson('component/button.json', {
      button: { primary: { bg: { $value: '{color.interactive.default}' } } },
    });

    const result = diffTokens(
      [makeGlobal({ name: 'color.blue.500', value: '#2563EB' })],
      [makeSemantic({ name: 'color.text.primary', reference: '{color.gray.800}' })],
      [makeComponent({ name: 'button.primary.bg', reference: '{color.interactive.default}' })],
      testDir,
    );

    expect(result.modified).toBe(2); // global + semantic changed
    expect(result.unchanged).toBe(1); // component unchanged
    expect(result.changes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Typography semantic tokens
// ---------------------------------------------------------------------------

describe('typography tokens', () => {
  it('diffs typography semantic tokens correctly', () => {
    writeTokenJson('semantic/typography.json', {
      fontSize: { sm: { $value: '14px' } },
    });

    const result = diffTokens(
      [],
      [makeSemantic({ name: 'fontSize.sm', reference: '16px', theme: 'typography' })],
      [],
      testDir,
    );

    expect(result.modified).toBe(1);
    expect(result.changes[0]?.before).toBe('14px');
    expect(result.changes[0]?.after).toBe('16px');
  });
});

// ---------------------------------------------------------------------------
// Value normalization
// ---------------------------------------------------------------------------

describe('value normalization', () => {
  it('normalizes array values from disk to comma-separated for comparison', () => {
    writeTokenJson('global/typography.json', {
      fontFamily: { sans: { $value: ['Inter', 'system-ui', 'sans-serif'] } },
    });

    // Notion stores as comma-separated string
    const result = diffTokens(
      [makeGlobal({ name: 'fontFamily.sans', value: 'Inter, system-ui, sans-serif', type: 'fontFamily', category: 'fontFamily' })],
      [],
      [],
      testDir,
    );

    expect(result.modified).toBe(0);
    expect(result.unchanged).toBe(1);
  });

  it('normalizes numeric values from disk to string for comparison', () => {
    writeTokenJson('global/typography.json', {
      fontWeight: { medium: { $value: 500 } },
    });

    const result = diffTokens(
      [makeGlobal({ name: 'fontWeight.medium', value: '500', type: 'fontWeight', category: 'fontWeight' })],
      [],
      [],
      testDir,
    );

    expect(result.modified).toBe(0);
    expect(result.unchanged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------

describe('summary counts', () => {
  it('reports correct totals', () => {
    writeTokenJson('global/colors.json', {
      color: {
        blue: { '500': { $value: '#217CF5' } },
        red: { '500': { $value: '#D92D20' } },
      },
    });

    const result = diffTokens(
      [
        makeGlobal({ name: 'color.blue.500', value: '#2563EB' }),  // modified
        makeGlobal({ name: 'color.green.500', value: '#16A34A' }), // added
        // color.red.500 on disk but not in Notion → removed
      ],
      [],
      [],
      testDir,
    );

    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.modified).toBe(1);
    expect(result.total).toBe(2); // 2 tokens from Notion
  });
});