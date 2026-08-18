// @file: Composite Android/Gradle project detection per spec §3.6.
// @consumers: android-plugin
// @tasks: TSK-97

import fs from 'node:fs';
import path from 'node:path';
import type { StackDetection, StackDiagnostic } from '../../stack.types.ts';
import { parseVersionCatalog } from './android-version-catalog.logic.ts';
import { parseSettingsGradle, DEFAULT_INCLUDE_LIMIT } from './android-settings.logic.ts';

/** AGP plugin ids the detect algorithm accepts as an Android project (spec §3.6 step 2). */
const AGP_IDS: readonly string[] = ['com.android.application', 'com.android.library'];

/** Optional Gradle plugin ids that gate the ktlint/detekt/spotless verify gates (spec §3.6 step 5). */
export const OPTIONAL_PLUGIN_IDS = {
  ktlint: 'org.jlleitschuh.gradle.ktlint',
  detekt: 'io.gitlab.arturbosch.detekt',
  spotless: 'com.diffplug.spotless',
} as const;

/** Which optional Gradle plugins were seen in the detect scope. */
export type OptionalPluginPresence = Readonly<Record<keyof typeof OPTIONAL_PLUGIN_IDS, boolean>>;

/**
 * @purpose Detection payload of the android plugin — plan and scope stages consume this.
 * @consumer android-plugin (internal)
 */
export type AndroidProject = {
  /** @purpose Absolute repository root the wrapper files live at. */
  readonly root: string;
  /** @purpose Absolute path to the build.gradle{.kts} that actually applies the AGP plugin. */
  readonly agpHolderFile: string;
  /** @purpose Repo-relative module name (e.g. `app`) — empty when AGP was found in the root file. */
  readonly agpHolderModule: string;
  /** @purpose AGP version parsed from libs.versions.toml when available. */
  readonly agpVersion: string | null;
  /** @purpose Submodules discovered from settings.gradle (capped at 32). */
  readonly submodules: readonly string[];
  /** @purpose Resolved AGP alias name from libs.versions.toml, when the alias form was used. */
  readonly resolvedAlias: string | null;
  /** @purpose Canonical wrapper paths for the summary. */
  readonly wrapperPaths: Readonly<{ settings: string; build: string; gradlew: string }>;
  /** @purpose Which optional plugins (ktlint/detekt/spotless) were seen in the scope. */
  readonly optionalPlugins: OptionalPluginPresence;
};

/**
 * @purpose Prefer `.kts` over `.gradle` when both may exist — spec §3.6 file-selection rule.
 * @param base Absolute path prefix (e.g. `/root/build.gradle`).
 * @returns The `.kts` variant if it exists, else the `.gradle` variant if it exists, else null.
 */
function pickKtsThenGroovy(base: string): string | null {
  const kts = `${base}.kts`;
  if (fs.existsSync(kts)) {
    return kts;
  }
  if (fs.existsSync(base)) {
    return base;
  }
  return null;
}

/**
 * @purpose Read a file, returning empty content on any error (missing/permission/binary).
 * @param file Absolute file path.
 * @returns File contents, or empty string.
 */
function readSafe(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * @purpose Convert a TOML alias name to its Gradle DSL access path (spec §3.6 step 3).
 * @param alias TOML alias name (e.g. `android-application`, `android_application`).
 * @returns Dot-separated DSL path (`android.application`).
 */
function aliasToDslPath(alias: string): string {
  return alias.replace(/[-_]/g, '.');
}

/**
 * @purpose Escape a string for insertion into a regex literal.
 * @param source Raw string.
 * @returns Regex-safe form.
 */
function escapeRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @purpose Detect whether a build.gradle{.kts} content applies a plugin (direct or alias form).
 * @invariant TOML-first alias resolution (spec §3.6 step 3): filter alias names by id, convert
 *   `-`/`_` → `.`, then match `alias(libs.plugins.<path>)`.
 * @param content build.gradle{.kts} text.
 * @param pluginId Plugin id to detect (e.g. `com.android.application`).
 * @param aliasMap TOML alias → id map (empty when the catalog was absent).
 * @returns The resolved alias name when the alias form matched; empty string when direct-form matched; null otherwise.
 */
function findPluginApplication(
  content: string,
  pluginId: string,
  aliasMap: Map<string, string>
): string | null {
  // Direct forms: id("<pluginId>"), id('<pluginId>'), id "<pluginId>" (Kotlin + Groovy DSL).
  const directRe = new RegExp(`\\bid\\s*[(\\s]\\s*["']${escapeRegex(pluginId)}["']`);
  if (directRe.test(content)) {
    return '';
  }

  // Alias form: iterate TOML aliases whose id matches, look for alias(libs.plugins.<path>).
  for (const [alias, id] of aliasMap.entries()) {
    if (id !== pluginId) {
      continue;
    }
    const dslPath = aliasToDslPath(alias);
    const aliasRe = new RegExp(`alias\\s*\\(\\s*libs\\.plugins\\.${escapeRegex(dslPath)}\\b`);
    if (aliasRe.test(content)) {
      return alias;
    }
  }

  return null;
}

/**
 * @purpose Test whether any AGP plugin (application or library) is applied inside `content`.
 * @param content build.gradle{.kts} text.
 * @param aliasMap TOML alias → id map.
 * @returns Resolved alias when alias-form matched; '' when direct-form matched; null otherwise.
 */
function findAgpApplication(content: string, aliasMap: Map<string, string>): string | null {
  for (const id of AGP_IDS) {
    const hit = findPluginApplication(content, id, aliasMap);
    if (hit !== null) {
      return hit;
    }
  }
  return null;
}

/**
 * @purpose Parse the AGP version out of libs.versions.toml when the catalog is present.
 *   The catalog either references a `[versions]` entry or embeds the version directly.
 * @param tomlPath Absolute path to `libs.versions.toml`.
 * @returns Version string, or null.
 */
function parseAgpVersion(tomlPath: string): string | null {
  const content = readSafe(tomlPath);
  if (content.length === 0) {
    return null;
  }
  // Match `<alias> = { id = "com.android.<app|library>", version(.ref)? = "<value>" }`
  const inlineRe =
    /^\s*[A-Za-z0-9_-]+\s*=\s*\{[^}]*\bid\s*=\s*"com\.android\.(?:application|library)"[^}]*\bversion(?:\.ref)?\s*=\s*"([^"]+)"/m;
  const inlineMatch = inlineRe.exec(content);
  if (inlineMatch !== null) {
    const value = inlineMatch[1]!;
    // If the inline form used `version.ref`, resolve it against [versions].
    const versionsRe = new RegExp(`^\\s*${escapeRegex(value)}\\s*=\\s*"([^"]+)"`, 'm');
    const referenced = versionsRe.exec(content);
    return referenced !== null ? referenced[1]! : value;
  }
  // String form: `<alias> = "com.android.application:<version>"`
  const stringRe = /^\s*[A-Za-z0-9_-]+\s*=\s*"com\.android\.(?:application|library):([^"]+)"/m;
  const stringMatch = stringRe.exec(content);
  return stringMatch !== null ? stringMatch[1]! : null;
}

/**
 * @purpose Test whether the required wrapper files are all in place (spec §3.6 step 1).
 * @param root Repository root.
 * @returns Chosen settings/build file paths when the check passes, or null when any file is missing.
 */
function checkWrapperFiles(
  root: string
): { readonly settings: string; readonly build: string; readonly gradlew: string } | null {
  const settings = pickKtsThenGroovy(path.join(root, 'settings.gradle'));
  const build = pickKtsThenGroovy(path.join(root, 'build.gradle'));
  const gradlew = path.join(root, 'gradlew');
  const wrapperJar = path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  const wrapperProps = path.join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties');

  if (
    settings === null ||
    build === null ||
    !fs.existsSync(gradlew) ||
    !fs.existsSync(wrapperJar) ||
    !fs.existsSync(wrapperProps)
  ) {
    return null;
  }
  return { settings, build, gradlew };
}

/**
 * @purpose Detect optional Gradle plugins in a set of build.gradle{.kts} contents.
 * @param contents Files to search (root, and — when multi-module — the AGP holder).
 * @param aliasMap TOML alias → id map (may be empty; alias form silently skipped when empty).
 * @returns Presence map for ktlint/detekt/spotless.
 */
function detectOptionalPlugins(
  contents: readonly string[],
  aliasMap: Map<string, string>
): OptionalPluginPresence {
  const seen: Record<keyof typeof OPTIONAL_PLUGIN_IDS, boolean> = {
    ktlint: false,
    detekt: false,
    spotless: false,
  };
  for (const [key, id] of Object.entries(OPTIONAL_PLUGIN_IDS) as [
    keyof typeof OPTIONAL_PLUGIN_IDS,
    string,
  ][]) {
    for (const content of contents) {
      if (findPluginApplication(content, id, aliasMap) !== null) {
        seen[key] = true;
        break;
      }
    }
  }
  return seen;
}

/**
 * @purpose Result of `detectAndroid`: detection payload plus a side-channel for diagnostics
 *   the plugin surface cannot ride (StackPlugin.detect returns `StackDetection | null`).
 * @consumer android-plugin, tests
 */
export type AndroidDetectResult = {
  /** @purpose Detection payload, or null when detection failed. */
  readonly detection: StackDetection | null;
  /** @purpose Diagnostics that arise on the null-detect path (e.g. `ANDROID_MODULE_LIMIT_EXCEEDED`). */
  readonly diagnostics: readonly StackDiagnostic[];
};

/**
 * @purpose Detect an Android/Gradle project at `root` per spec §3.6.
 * @invariant Steps 1–6 in order; missing wrapper → null, no diagnostic (D-STACK-014); TOML-first
 *   alias resolution; multi-module fallback capped at 32 (`ANDROID_MODULE_LIMIT_EXCEEDED`).
 * @param root Absolute repository root.
 * @returns Detection with AGP holder + optional-plugin presence, or null; plus diagnostics.
 */
export function detectAndroid(root: string): AndroidDetectResult {
  // Step 1 — wrapper files.
  const wrapper = checkWrapperFiles(root);
  if (wrapper === null) {
    return { detection: null, diagnostics: [] };
  }

  // Step 2 — try the root build.gradle{.kts}, direct + alias form.
  const rootBuildContent = readSafe(wrapper.build);
  const tomlPath = path.join(root, 'gradle', 'libs.versions.toml');
  const tomlExists = fs.existsSync(tomlPath);
  // TOML is read lazily: only when either the alias form is needed (step 3) or step 5 needs it.
  let aliasMap: Map<string, string> | null = null;
  const getAliasMap = (): Map<string, string> => {
    if (aliasMap === null) {
      aliasMap = tomlExists ? parseVersionCatalog(tomlPath) : new Map<string, string>();
    }
    return aliasMap;
  };

  let agpHolderFile = wrapper.build;
  let agpHolderModule = '';
  let resolvedAlias: string | null = null;
  const rootAgpResult = findAgpApplication(rootBuildContent, getAliasMap());
  const rootHit = rootAgpResult !== null;

  // Step 4 — fallback to submodules when the root file did not apply AGP.
  let submodules: readonly string[] = [];
  const diagnostics: StackDiagnostic[] = [];
  if (!rootHit) {
    submodules = parseSettingsGradle(wrapper.settings, DEFAULT_INCLUDE_LIMIT);
    let holderFound = false;
    for (const module of submodules) {
      const relative = module.replace(/^:/, '').replace(/:/g, path.sep);
      const modBuild = pickKtsThenGroovy(path.join(root, relative, 'build.gradle'));
      if (modBuild === null) {
        continue;
      }
      const modContent = readSafe(modBuild);
      const modAgp = findAgpApplication(modContent, getAliasMap());
      if (modAgp !== null) {
        agpHolderFile = modBuild;
        agpHolderModule = relative;
        resolvedAlias = modAgp === '' ? null : modAgp;
        holderFound = true;
        break;
      }
    }
    if (!holderFound) {
      if (submodules.length === DEFAULT_INCLUDE_LIMIT) {
        // Cap hit — the AGP holder may live in the untraversed tail. Diagnostic goes via
        // the side channel because StackPlugin.detect only returns `StackDetection | null`;
        // the plugin surfaces it in the NO_STACK_DETECTED roster (spec §3.6 step 4).
        diagnostics.push({
          code: 'ANDROID_MODULE_LIMIT_EXCEEDED',
          message: `settings.gradle declares ${submodules.length}+ modules (limit ${DEFAULT_INCLUDE_LIMIT}); AGP plugin not found in the first ${DEFAULT_INCLUDE_LIMIT}`,
          fix: `add \`stack.use: [android]\` to the config and pass \`--root=<path-to-module-with-AGP>\` to narrow detection to the holder module`,
        });
      }
      return { detection: null, diagnostics };
    }
  } else {
    resolvedAlias = rootAgpResult === '' ? null : rootAgpResult;
  }

  // Step 5 — optional plugins across the read contents.
  //   single-module branch: root only.
  //   multi-module branch: root + AGP holder.
  const holderContent = rootHit ? '' : readSafe(agpHolderFile);
  const optionalContents = rootHit ? [rootBuildContent] : [rootBuildContent, holderContent];
  const optionalPlugins = detectOptionalPlugins(optionalContents, getAliasMap());

  // Step 6 — assemble the detection.
  const agpVersion = tomlExists ? parseAgpVersion(tomlPath) : null;
  const project: AndroidProject = {
    root,
    agpHolderFile,
    agpHolderModule,
    agpVersion,
    submodules,
    resolvedAlias,
    wrapperPaths: {
      settings: wrapper.settings,
      build: wrapper.build,
      gradlew: wrapper.gradlew,
    },
    optionalPlugins,
  };

  const summary: string[] = [
    `module:    ${agpHolderModule.length > 0 ? `:${agpHolderModule}` : '(root)'} (holder of ${AGP_IDS[0]}${resolvedAlias !== null ? ` via alias ${resolvedAlias}` : ''})`,
    `file:      ${path.relative(root, agpHolderFile) || path.basename(agpHolderFile)}`,
    `agp:       ${agpVersion ?? '(unknown — libs.versions.toml missing or version not embedded)'}`,
  ];

  return {
    detection: {
      stack: 'android',
      root,
      summary,
      diagnostics,
      details: project,
    },
    diagnostics,
  };
}
