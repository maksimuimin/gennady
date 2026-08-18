// @file: Hand-rolled parser for `settings.gradle{.kts}` `include(...)` statements.
// @consumers: android-detect.logic
// @tasks: TSK-97

import fs from 'node:fs';

/** Default limit on module names surfaced by the detector (spec §3.6 step 4). */
export const DEFAULT_INCLUDE_LIMIT = 32;

/**
 * @purpose Extract submodule names from a `settings.gradle{.kts}` file (Kotlin + Groovy forms),
 *   capped at `limit` to bound detection time (§3.6 step 4, `ANDROID_MODULE_LIMIT_EXCEEDED`).
 * @param path Absolute path to `settings.gradle` or `settings.gradle.kts`.
 * @param [limit] Maximum module names to return; defaults to `DEFAULT_INCLUDE_LIMIT`.
 * @returns Module names in file order, capped at `limit`; empty when the file is missing.
 */
export function parseSettingsGradle(path: string, limit: number = DEFAULT_INCLUDE_LIMIT): string[] {
  let content: string;
  try {
    content = fs.readFileSync(path, 'utf-8');
  } catch {
    return [];
  }

  const modules: string[] = [];
  // Matches `include(":x", ":y")` (Kotlin) and `include ':x', ':y'` (Groovy);
  // each argument is one quoted string, `:` is optional in the leading position.
  const argRe = /["']:?([A-Za-z0-9_.:-]+)["']/g;
  // Iterate over statements: `include(...)` or `include ...` up to newline or `)`.
  const stmtRe = /\binclude\b\s*(?:\(([^)]*)\)|([^\n]*))/g;

  for (const stmt of content.matchAll(stmtRe)) {
    const body = stmt[1] ?? stmt[2] ?? '';
    for (const arg of body.matchAll(argRe)) {
      const name = arg[1]!;
      if (modules.push(name) >= limit) {
        return modules;
      }
    }
  }

  return modules;
}
