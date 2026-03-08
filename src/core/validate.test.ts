import { describe, it, expect } from 'vitest';
import { validateTokens } from './validate.js';
import type { GlobalToken, SemanticToken, ComponentToken } from './types.js';

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
    status: 'modified',
    ...overrides,
  };
}

function makeSemantic(overrides: Partial<SemanticToken> = {}): SemanticToken {
  return {
    pageId: 'page-2',
    name: 'color.text.primary',
    reference: '{color.blue.500}',
    theme: 'light',
    status: 'modified',
    ...overrides,
  };
}

function makeComponent(overrides: Partial<ComponentToken> = {}): ComponentToken {
  return {
    pageId: 'page-3',
    name: 'button.primary.bg',
    reference: '{color.text.primary}',
    component: 'button',
    status: 'modified',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Token name validation
// ---------------------------------------------------------------------------

describe('token name validation', () => {
  it('accepts valid dot-notation names', () => {
    const result = validateTokens(
      [makeGlobal({ name: 'color.blue.500' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('rejects empty names', () => {
    const result = validateTokens(
      [makeGlobal({ name: '' })],
      [],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('empty');
  });

  it('rejects names with consecutive dots', () => {
    const result = validateTokens(
      [makeGlobal({ name: 'color..blue' })],
      [],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('Invalid token name');
  });

  it('rejects names with leading dots', () => {
    const result = validateTokens(
      [makeGlobal({ name: '.color.blue' })],
      [],
      [],
    );
    expect(result.valid).toBe(false);
  });

  it('rejects names with trailing dots', () => {
    const result = validateTokens(
      [makeGlobal({ name: 'color.blue.' })],
      [],
      [],
    );
    expect(result.valid).toBe(false);
  });

  it('rejects names with slashes', () => {
    const result = validateTokens(
      [makeGlobal({ name: 'color/blue/500' })],
      [],
      [],
    );
    expect(result.valid).toBe(false);
  });

  it('accepts names with hyphens', () => {
    const result = validateTokens(
      [makeGlobal({ name: 'font-size.sm' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Color validation
// ---------------------------------------------------------------------------

describe('color validation', () => {
  it('accepts valid 6-digit hex', () => {
    const result = validateTokens([makeGlobal({ value: '#FF0000' })], [], []);
    expect(result.valid).toBe(true);
  });

  it('accepts valid 3-digit hex', () => {
    const result = validateTokens([makeGlobal({ value: '#F00' })], [], []);
    expect(result.valid).toBe(true);
  });

  it('accepts valid 8-digit hex (with alpha)', () => {
    const result = validateTokens([makeGlobal({ value: '#FF000080' })], [], []);
    expect(result.valid).toBe(true);
  });

  it('accepts transparent', () => {
    const result = validateTokens([makeGlobal({ value: 'transparent' })], [], []);
    expect(result.valid).toBe(true);
  });

  it('accepts none', () => {
    const result = validateTokens([makeGlobal({ value: 'none' })], [], []);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid hex', () => {
    const result = validateTokens([makeGlobal({ value: '#GGG' })], [], []);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('Invalid color');
  });

  it('rejects 5-digit hex', () => {
    const result = validateTokens([makeGlobal({ value: '#12345' })], [], []);
    expect(result.valid).toBe(false);
  });

  it('rejects empty value', () => {
    const result = validateTokens([makeGlobal({ value: '' })], [], []);
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('empty');
  });
});

// ---------------------------------------------------------------------------
// Dimension validation
// ---------------------------------------------------------------------------

describe('dimension validation', () => {
  it('accepts px values', () => {
    const result = validateTokens(
      [makeGlobal({ value: '16px', type: 'dimension', category: 'spacing' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('accepts rem values', () => {
    const result = validateTokens(
      [makeGlobal({ value: '1.5rem', type: 'dimension', category: 'spacing' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('accepts unitless numbers (line-height)', () => {
    const result = validateTokens(
      [makeGlobal({ value: '1.25', type: 'dimension', category: 'lineHeight' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('accepts none', () => {
    const result = validateTokens(
      [makeGlobal({ value: 'none', type: 'dimension', category: 'shadow' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('accepts shadow values categorized as dimension', () => {
    const result = validateTokens(
      [makeGlobal({ value: '0px 1px 2px 0px rgba(16, 24, 40, 0.05)', type: 'dimension', category: 'shadow' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('rejects invalid dimension', () => {
    const result = validateTokens(
      [makeGlobal({ value: 'abc', type: 'dimension', category: 'spacing' })],
      [],
      [],
    );
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Font weight validation
// ---------------------------------------------------------------------------

describe('fontWeight validation', () => {
  it('accepts numeric weights', () => {
    const result = validateTokens(
      [makeGlobal({ value: '500', type: 'fontWeight', category: 'fontWeight' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('rejects non-numeric weights', () => {
    const result = validateTokens(
      [makeGlobal({ value: 'bold', type: 'fontWeight', category: 'fontWeight' })],
      [],
      [],
    );
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shadow validation
// ---------------------------------------------------------------------------

describe('shadow validation', () => {
  it('accepts complex shadow values', () => {
    const result = validateTokens(
      [makeGlobal({ value: '0px 4px 8px rgba(0,0,0,0.1)', type: 'shadow', category: 'shadow' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('accepts none', () => {
    const result = validateTokens(
      [makeGlobal({ value: 'none', type: 'shadow', category: 'shadow' })],
      [],
      [],
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reference validation
// ---------------------------------------------------------------------------

describe('reference validation', () => {
  it('validates semantic references to global tokens', () => {
    const result = validateTokens(
      [makeGlobal({ name: 'color.blue.500' })],
      [makeSemantic({ reference: '{color.blue.500}' })],
      [],
    );
    expect(result.valid).toBe(true);
  });

  it('rejects unresolved semantic references', () => {
    const result = validateTokens(
      [makeGlobal({ name: 'color.blue.500' })],
      [makeSemantic({ reference: '{color.red.500}' })],
      [],
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toContain('Unresolved reference');
  });

  it('validates component references to semantic tokens', () => {
    const global = [makeGlobal({ name: 'color.blue.500' })];
    const semantic = [makeSemantic({ name: 'color.text.primary', reference: '{color.blue.500}' })];
    const component = [makeComponent({ reference: '{color.text.primary}' })];

    const result = validateTokens(global, semantic, component);
    expect(result.valid).toBe(true);
  });

  it('accepts plain values in component tokens (e.g., transparent)', () => {
    const result = validateTokens(
      [makeGlobal({ name: 'color.blue.500' })],
      [],
      [makeComponent({ reference: 'transparent' })],
    );
    expect(result.valid).toBe(true);
  });

  it('accepts typography semantic tokens with raw values (not references)', () => {
    const result = validateTokens(
      [],
      [
        makeSemantic({ name: 'fontFamily.sans', reference: 'Inter, system-ui, sans-serif', theme: 'typography' }),
        makeSemantic({ name: 'fontSize.sm', reference: '14px', theme: 'typography' }),
        makeSemantic({ name: 'fontWeight.medium', reference: '500', theme: 'typography' }),
        makeSemantic({ name: 'lineHeight.normal', reference: '1.5', theme: 'typography' }),
      ],
      [],
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Circular reference detection
// ---------------------------------------------------------------------------

describe('circular reference detection', () => {
  it('detects direct circular references', () => {
    const semantic = [
      makeSemantic({ name: 'a', reference: '{b}' }),
      makeSemantic({ name: 'b', reference: '{a}' }),
    ];

    // Need 'a' and 'b' in global paths for ref validation to pass
    const global = [
      makeGlobal({ name: 'a' }),
      makeGlobal({ name: 'b' }),
    ];

    const result = validateTokens(global, semantic, []);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Circular reference'))).toBe(true);
  });

  it('passes with no circular references', () => {
    const global = [makeGlobal({ name: 'color.blue.500' })];
    const semantic = [makeSemantic({ name: 'color.text.primary', reference: '{color.blue.500}' })];

    const result = validateTokens(global, semantic, []);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Token count
// ---------------------------------------------------------------------------

describe('token count', () => {
  it('reports correct total across all tiers', () => {
    const result = validateTokens(
      [makeGlobal(), makeGlobal({ name: 'color.red.500', value: '#D92D20' })],
      [makeSemantic()],
      [makeComponent()],
    );
    expect(result.tokenCount).toBe(4);
  });
});
