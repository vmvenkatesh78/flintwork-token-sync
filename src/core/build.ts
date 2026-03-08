import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

export interface BuildResult {
  success: boolean;
  output: string;
  duration: number;
}

/**
 * Runs flintwork's token build pipeline by executing the build-tokens.ts
 * script from the flintwork project directory.
 *
 * The tokens path (e.g., "../flintwork/src/tokens") is used to derive
 * the project root (two levels up from src/tokens).
 */
export function runTokenBuild(tokensPath: string): BuildResult {
  // Derive flintwork project root from tokens path
  // tokensPath = ".../flintwork/src/tokens" → projectRoot = ".../flintwork"
  const projectRoot = resolve(tokensPath, '..', '..');

  const buildScript = resolve(projectRoot, 'src', 'scripts', 'build-tokens.ts');

  if (!existsSync(buildScript)) {
    return {
      success: false,
      output: `Build script not found at ${buildScript}`,
      duration: 0,
    };
  }

  const start = Date.now();

  try {
    const output = execSync('npx tsx src/scripts/build-tokens.ts', {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 30_000,
    });

    return {
      success: true,
      output: output.trim(),
      duration: Date.now() - start,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      output: message,
      duration: Date.now() - start,
    };
  }
}
