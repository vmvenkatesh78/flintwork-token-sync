import type {
  GlobalToken,
  SemanticToken,
  ComponentToken,
  ValidationError,
  ValidationResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const DIMENSION = /^\d+(\.\d+)?(px|rem|em|%)$/;
const REFERENCE = /^\{[^}]+\}$/;
const REFERENCE_PATH = /\{([^}]+)\}/g;
const NUMBER_VALUE = /^\d+(\.\d+)?$/;

/**
 * Valid token name: dot-separated segments, each non-empty, no leading/
 * trailing dots, no consecutive dots, alphanumeric + hyphens only.
 */
const VALID_TOKEN_NAME = /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/;

/**
 * Validates a token name is well-formed dot notation.
 * Catches empty segments, leading dots, trailing dots, slashes,
 * and other characters that would produce corrupt JSON paths.
 */
function validateTokenName(name: string): ValidationError | null {
  if (!name.trim()) {
    return { token: '(empty)', message: 'Token name is empty.' };
  }

  if (!VALID_TOKEN_NAME.test(name)) {
    return {
      token: name,
      message: `Invalid token name. Expected dot-separated alphanumeric segments (e.g., "color.blue.500"). Got: "${name}".`,
    };
  }

  return null;
}

/**
 * Validates a raw global token value based on its type.
 */
function validateGlobalValue(token: GlobalToken): ValidationError | null {
  const { name, value, type } = token;

  if (!value.trim()) {
    return { token: name, message: 'Value is empty.' };
  }

  switch (type) {
    case 'color':
      if (!HEX_COLOR.test(value) && value !== 'transparent' && value !== 'none') {
        return { token: name, message: `Invalid color value: "${value}". Expected hex format (#RGB, #RRGGBB, or #RRGGBBAA), "transparent", or "none".` };
      }
      break;

    case 'dimension':
      // Accepts: "16px", "1.5rem", "0px", "none", unitless numbers like
      // "1.25" (valid for line-height), and complex multi-part values
      // containing rgba/rgb (shadow values may be categorized as dimension
      // during seeding due to the "px" substring matching first).
      //
      // Known limitation: any string containing "rgba" or "rgb" passes.
      // A value like "rgb broken" would not be caught. The proper fix is
      // separating shadow validation from dimension validation entirely,
      // but this requires the seed script to correctly categorize all
      // shadow tokens as type "shadow" — which it now does for new seeds.
      // Legacy seeded data may still have shadows typed as "dimension".
      if (
        !DIMENSION.test(value) &&
        !NUMBER_VALUE.test(value) &&
        value !== '0px' &&
        value !== 'none' &&
        !value.includes('rgba') &&
        !value.includes('rgb')
      ) {
        return { token: name, message: `Invalid dimension value: "${value}". Expected a number with optional units (px, rem, em, %).` };
      }
      break;

    case 'fontWeight':
      if (!NUMBER_VALUE.test(value)) {
        return { token: name, message: `Invalid font weight: "${value}". Expected a numeric value (e.g., 400, 500, 700).` };
      }
      break;

    case 'fontFamily': {
      // Font families can be comma-separated strings — just check non-empty
      if (!value.trim()) {
        return { token: name, message: 'Font family value is empty.' };
      }
      break;
    }

    case 'shadow':
      // Shadows are complex values — validate non-empty. "none" is valid.
      if (!value.trim()) {
        return { token: name, message: 'Shadow value is empty.' };
      }
      break;
  }

  return null;
}

/**
 * Validates that a reference string points to an existing token.
 */
function validateReference(
  tokenName: string,
  reference: string,
  knownPaths: Set<string>,
): ValidationError | null {
  if (!REFERENCE.test(reference) && !reference.includes('{')) {
    // Plain value like "transparent" — not a reference, valid
    return null;
  }

  // Extract all reference paths from the value
  const matches = reference.matchAll(REFERENCE_PATH);
  for (const match of matches) {
    const refPath = match[1];
    if (refPath && !knownPaths.has(refPath)) {
      return {
        token: tokenName,
        message: `Unresolved reference: "{${refPath}}" does not match any known token.`,
      };
    }
  }

  return null;
}

/**
 * Detects circular references in token chains.
 * Uses iterative depth tracking instead of recursion.
 */
function detectCircularReferences(
  tokens: Array<{ name: string; reference: string }>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const refMap = new Map<string, string>();

  for (const token of tokens) {
    const match = REFERENCE_PATH.exec(token.reference);
    REFERENCE_PATH.lastIndex = 0; // Reset regex state
    if (match?.[1]) {
      refMap.set(token.name, match[1]);
    }
  }

  for (const [startName] of refMap) {
    const visited = new Set<string>();
    let current: string | undefined = startName;

    while (current) {
      if (visited.has(current)) {
        errors.push({
          token: startName,
          message: `Circular reference detected: ${[...visited, current].join(' → ')}`,
        });
        break;
      }
      visited.add(current);
      current = refMap.get(current);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

/**
 * Validates all tokens across the three tiers.
 *
 * Checks:
 * 1. Global token values match their declared type (hex, dimension, etc.)
 * 2. Semantic token references point to existing global tokens
 * 3. Component token references point to existing semantic or global tokens
 * 4. No circular references in the semantic or component tiers
 */
export function validateTokens(
  global: GlobalToken[],
  semantic: SemanticToken[],
  component: ComponentToken[],
): ValidationResult {
  const errors: ValidationError[] = [];

  // Build a set of all known token paths for reference validation
  const globalPaths = new Set(global.map((t) => t.name));
  const semanticPaths = new Set(semantic.map((t) => t.name));
  const allPaths = new Set([...globalPaths, ...semanticPaths]);

  // 0. Validate token names across all tiers
  const allTokenNames = [
    ...global.map((t) => t.name),
    ...semantic.map((t) => t.name),
    ...component.map((t) => t.name),
  ];

  for (const name of allTokenNames) {
    const error = validateTokenName(name);
    if (error) errors.push(error);
  }

  // 1. Validate global token values
  for (const token of global) {
    const error = validateGlobalValue(token);
    if (error) errors.push(error);
  }

  // 2. Validate semantic token references point to global tokens
  for (const token of semantic) {
    const error = validateReference(token.name, token.reference, globalPaths);
    if (error) errors.push(error);
  }

  // 3. Validate component token references point to semantic or global tokens
  for (const token of component) {
    // Component tokens can reference semantic or global tokens
    // "transparent" and other plain values are also valid
    const error = validateReference(token.name, token.reference, allPaths);
    if (error) errors.push(error);
  }

  // 4. Detect circular references
  const semanticRefs = semantic.map((t) => ({ name: t.name, reference: t.reference }));
  const componentRefs = component.map((t) => ({ name: t.name, reference: t.reference }));
  errors.push(...detectCircularReferences([...semanticRefs, ...componentRefs]));

  const tokenCount = global.length + semantic.length + component.length;

  return {
    valid: errors.length === 0,
    errors,
    tokenCount,
  };
}
