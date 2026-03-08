import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateTokenFiles } from './generate-json.js';
import type { GlobalToken, SemanticToken, ComponentToken } from './types.js';

// ---------------------------------------------------------------------------
// Test directory management
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'flintwork-test-'));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function readGeneratedJson(relativePath: string): Record<string, unknown> {
  const filePath = join(testDir, relativePath);
  return JSON.parse(readFileSync(filePath, 'utf-8'));
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
// Global token file generation
// ---------------------------------------------------------------------------

describe('global token generation', () => {
  it('creates colors.json from color tokens', () => {
    const result = generateTokenFiles(
      [
        makeGlobal({ name: 'color.blue.500', value: '#217CF5' }),
        makeGlobal({ name: 'color.blue.600', value: '#1A4AC8' }),
      ],
      [],
      [],
      testDir,
    );

    expect(result.globalFiles).toBe(1);
    const json = readGeneratedJson('global/colors.json');
    const colorObj = json['color'] as Record<string, unknown>;
    const blueObj = colorObj['blue'] as Record<string, unknown>;
    expect(blueObj['500']).toEqual({ $value: '#217CF5' });
    expect(blueObj['600']).toEqual({ $value: '#1A4AC8' });
  });

  it('creates spacing.json from spacing tokens', () => {
    generateTokenFiles(
      [makeGlobal({ name: 'spacing.4', value: '16px', type: 'dimension', category: 'spacing' })],
      [],
      [],
      testDir,
    );

    const json = readGeneratedJson('global/spacing.json');
    const spacing = json['spacing'] as Record<string, unknown>;
    expect(spacing['4']).toEqual({ $value: '16px' });
  });

  it('merges typography tokens into one file', () => {
    generateTokenFiles(
      [
        makeGlobal({ name: 'fontSize.sm', value: '14px', type: 'dimension', category: 'fontSize' }),
        makeGlobal({ name: 'fontWeight.medium', value: '500', type: 'fontWeight', category: 'fontWeight' }),
      ],
      [],
      [],
      testDir,
    );

    // Both should be in typography.json
    const json = readGeneratedJson('global/typography.json');
    const fontSize = json['fontSize'] as Record<string, unknown>;
    const fontWeight = json['fontWeight'] as Record<string, unknown>;
    expect(fontSize['sm']).toEqual({ $value: '14px' });
    expect(fontWeight['medium']).toEqual({ $value: 500 });
  });

  it('stores font weight as number, not string', () => {
    generateTokenFiles(
      [makeGlobal({ name: 'fontWeight.bold', value: '700', type: 'fontWeight', category: 'fontWeight' })],
      [],
      [],
      testDir,
    );

    const json = readGeneratedJson('global/typography.json');
    const fontWeight = json['fontWeight'] as Record<string, unknown>;
    expect(fontWeight['bold']).toEqual({ $value: 700 });
  });

  it('stores font family as array', () => {
    generateTokenFiles(
      [makeGlobal({ name: 'fontFamily.sans', value: 'Inter, system-ui, sans-serif', type: 'fontFamily', category: 'fontFamily' })],
      [],
      [],
      testDir,
    );

    const json = readGeneratedJson('global/typography.json');
    const fontFamily = json['fontFamily'] as Record<string, unknown>;
    expect(fontFamily['sans']).toEqual({ $value: ['Inter', 'system-ui', 'sans-serif'] });
  });
});

// ---------------------------------------------------------------------------
// Semantic token file generation
// ---------------------------------------------------------------------------

describe('semantic token generation', () => {
  it('creates light.json and dark.json', () => {
    const result = generateTokenFiles(
      [],
      [
        makeSemantic({ name: 'color.text.primary', reference: '{color.gray.900}', theme: 'light' }),
        makeSemantic({ name: 'color.text.primary', reference: '{color.gray.50}', theme: 'dark' }),
      ],
      [],
      testDir,
    );

    expect(result.semanticFiles).toBe(2);
    expect(existsSync(join(testDir, 'semantic/light.json'))).toBe(true);
    expect(existsSync(join(testDir, 'semantic/dark.json'))).toBe(true);
  });

  it('creates typography.json for typography theme tokens', () => {
    const result = generateTokenFiles(
      [],
      [
        makeSemantic({ name: 'fontFamily.sans', reference: 'Inter, system-ui, sans-serif', theme: 'typography' }),
        makeSemantic({ name: 'fontSize.sm', reference: '14px', theme: 'typography' }),
      ],
      [],
      testDir,
    );

    expect(existsSync(join(testDir, 'semantic/typography.json'))).toBe(true);
    const json = readGeneratedJson('semantic/typography.json');
    const fontFamily = json['fontFamily'] as Record<string, unknown>;
    expect(fontFamily['sans']).toEqual({ $value: 'Inter, system-ui, sans-serif' });
  });

  it('creates all three semantic files when all themes present', () => {
    const result = generateTokenFiles(
      [],
      [
        makeSemantic({ name: 'color.text.primary', reference: '{color.gray.900}', theme: 'light' }),
        makeSemantic({ name: 'color.text.primary', reference: '{color.gray.50}', theme: 'dark' }),
        makeSemantic({ name: 'fontSize.sm', reference: '14px', theme: 'typography' }),
      ],
      [],
      testDir,
    );

    expect(result.semanticFiles).toBe(3);
  });

  it('stores references as string values', () => {
    generateTokenFiles(
      [],
      [makeSemantic({ name: 'color.text.primary', reference: '{color.gray.900}' })],
      [],
      testDir,
    );

    const json = readGeneratedJson('semantic/light.json');
    const color = json['color'] as Record<string, unknown>;
    const text = color['text'] as Record<string, unknown>;
    expect(text['primary']).toEqual({ $value: '{color.gray.900}' });
  });
});

// ---------------------------------------------------------------------------
// Component token file generation
// ---------------------------------------------------------------------------

describe('component token generation', () => {
  it('creates separate files per component', () => {
    const result = generateTokenFiles(
      [],
      [],
      [
        makeComponent({ name: 'button.primary.bg', component: 'button' }),
        makeComponent({ name: 'dialog.overlay.bg', reference: '{color.bg.inverse}', component: 'dialog' }),
      ],
      testDir,
    );

    expect(result.componentFiles).toBe(2);
    expect(existsSync(join(testDir, 'component/button.json'))).toBe(true);
    expect(existsSync(join(testDir, 'component/dialog.json'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Result counts
// ---------------------------------------------------------------------------

describe('result counts', () => {
  it('reports correct file counts', () => {
    const result = generateTokenFiles(
      [makeGlobal()],
      [makeSemantic()],
      [makeComponent()],
      testDir,
    );

    expect(result.globalFiles).toBe(1);
    expect(result.semanticFiles).toBe(1);
    expect(result.componentFiles).toBe(1);
    expect(result.files).toHaveLength(3);
  });
});
