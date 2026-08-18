// @file: Hand-rolled parser for the Gradle Version Catalog's `[plugins]` section.
// @consumers: android-detect.logic
// @tasks: TSK-97

import fs from 'node:fs';

/**
 * @purpose Parse `libs.versions.toml` `[plugins]` section into an alias → id map (D-STACK-018,
 *   no TOML package). Alias names returned as-is; name conversion is the caller's job.
 * @invariant Does not read `build.gradle` and does not convert alias names (§3.6 step 3).
 * @param tomlPath Absolute path to `gradle/libs.versions.toml`.
 * @returns Map from TOML alias name to plugin id; empty when missing or no plugins section.
 */
export function parseVersionCatalog(tomlPath: string): Map<string, string> {
  const map = new Map<string, string>();
  let content: string;
  try {
    content = fs.readFileSync(tomlPath, 'utf-8');
  } catch {
    return map;
  }

  // #region START_SECTION_SLICE — read only the `[plugins]` block, up to the next `[section]`
  // Note: `\Z` is a PCRE anchor; JavaScript uses `(?![\s\S])` for end-of-string in regex.
  // Use a string-split approach for clarity: find `[plugins]`, then the next `[...]` header.
  const pluginsHeaderRe = /^\[plugins\][^\n]*\n/m;
  const headerMatch = pluginsHeaderRe.exec(content);
  if (headerMatch === null) {
    return map;
  }
  const afterHeader = content.slice(headerMatch.index + headerMatch[0].length);
  // Trim at the next `[section]` header (if any).
  const nextSectionRe = /^\[[^\]]+\]/m;
  const nextSectionMatch = nextSectionRe.exec(afterHeader);
  const section =
    nextSectionMatch !== null ? afterHeader.slice(0, nextSectionMatch.index) : afterHeader;
  // #endregion END_SECTION_SLICE

  // Alias names in TOML: letters, digits, `-`, `_`. Two forms per spec §3.6 step 3:
  //   inline: <alias> = { id = "<id>", ... }
  //   string: <alias> = "<id>:<version>"
  const inlineRe = /^\s*([A-Za-z0-9_-]+)\s*=\s*\{[^}]*\bid\s*=\s*"([^"]+)"/gm;
  const stringRe = /^\s*([A-Za-z0-9_-]+)\s*=\s*"([^":]+):[^"]*"/gm;

  for (const match of section.matchAll(inlineRe)) {
    map.set(match[1]!, match[2]!);
  }
  for (const match of section.matchAll(stringRe)) {
    // Inline form takes precedence when both somehow coexist for the same alias.
    if (!map.has(match[1]!)) {
      map.set(match[1]!, match[2]!);
    }
  }

  return map;
}
