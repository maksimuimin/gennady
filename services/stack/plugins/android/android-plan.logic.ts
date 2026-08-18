// @file: Gate plan for Android/Gradle projects — assemble → lint → test + optional ktlint/detekt/spotless.
// @consumers: android-plugin, stack-config (gate id list)
// @tasks: TSK-97

import type { Gate, GatePlanOptions } from '../../stack.types.ts';
import { parseDuration } from '../../stack-config.ts';
import type { AndroidProject } from './android-detect.logic.ts';

/** Identifier of a built-in android gate. */
export type AndroidGateId = 'assemble' | 'lint' | 'test' | 'ktlint' | 'detekt' | 'spotless';

/** Built-in android gates in run order — assemble is a prerequisite for lint/test. */
export const ANDROID_GATE_ORDER: readonly AndroidGateId[] = [
  'assemble',
  'lint',
  'test',
  'ktlint',
  'detekt',
  'spotless',
];

/** Human labels for each gate id. */
const GATE_LABELS: Readonly<Record<AndroidGateId, string>> = {
  assemble: './gradlew assembleDebug',
  lint: './gradlew lintDebug',
  test: './gradlew testDebugUnitTest',
  ktlint: './gradlew ktlintCheck',
  detekt: './gradlew detekt',
  spotless: './gradlew spotlessCheck',
};

/** Gradle task each gate invokes (via `./gradlew <task>`). */
const GATE_TASKS: Readonly<Record<AndroidGateId, string>> = {
  assemble: 'assembleDebug',
  lint: 'lintDebug',
  test: 'testDebugUnitTest',
  ktlint: 'ktlintCheck',
  detekt: 'detekt',
  spotless: 'spotlessCheck',
};

/** Default per-gate timeouts in ms (spec D-STACK-007). */
const GATE_TIMEOUTS_MS: Readonly<Record<AndroidGateId, number>> = {
  assemble: 10 * 60_000,
  lint: 5 * 60_000,
  test: 10 * 60_000,
  ktlint: 5 * 60_000,
  detekt: 5 * 60_000,
  spotless: 5 * 60_000,
};

/** Base gate ids — always executable when detect succeeds. */
const BASE_GATES: readonly AndroidGateId[] = ['assemble', 'lint', 'test'];

/** Optional gate ids — executable only when the corresponding Gradle plugin was seen (§3.6 step 5). */
const OPTIONAL_GATES: readonly AndroidGateId[] = ['ktlint', 'detekt', 'spotless'];

/** Which android plugin ids belong to which optional gate. */
const OPTIONAL_GATE_LABEL: Readonly<Record<'ktlint' | 'detekt' | 'spotless', string>> = {
  ktlint: 'ktlint',
  detekt: 'detekt',
  spotless: 'spotless',
};

/**
 * @purpose Resolve the effective timeout for a gate, honouring an override in `pluginConfig`.
 * @param id Gate identifier.
 * @param options Planning options; overrideGates[id].timeout is consulted when present.
 * @returns Effective timeout in ms.
 */
function resolveTimeout(id: AndroidGateId, options: GatePlanOptions): number {
  const override = options.pluginConfig?.overrideGates?.[id]?.timeout;
  if (override !== undefined) {
    const parsed = parseDuration(override);
    if (parsed !== null) {
      return parsed;
    }
  }
  return GATE_TIMEOUTS_MS[id];
}

/**
 * @purpose Plan the android gate list for a detected project.
 * @invariant Base gates always executable; optional gates skipped when plugin absent (§3.6 step 5);
 *   all gates: positive `timeoutMs`, `sandbox: false`, no `envFail` (D-STACK-017).
 * @param project Detected project — `optionalPlugins` drives skip reasons.
 * @param options Planning options; consulted for per-gate timeout overrides.
 * @returns Ordered gate plan.
 */
export function planAndroidGates(project: AndroidProject, options: GatePlanOptions): Gate[] {
  const gates: Gate[] = [];

  // #region START_BASE_GATES — assemble/lint/test always executable when detect succeeded
  for (const id of BASE_GATES) {
    gates.push({
      id,
      stack: 'android',
      label: GATE_LABELS[id],
      argv: ['./gradlew', GATE_TASKS[id]],
      cwd: project.root,
      timeoutMs: resolveTimeout(id, options),
      outputMeansFailure: false,
      sandbox: false,
      skipped: null,
    });
  }
  // #endregion END_BASE_GATES

  // #region START_OPTIONAL_GATES — ktlint/detekt/spotless gated on detected plugin presence
  for (const id of OPTIONAL_GATES) {
    const key = OPTIONAL_GATE_LABEL[id as keyof typeof OPTIONAL_GATE_LABEL];
    const present = project.optionalPlugins[key as keyof typeof project.optionalPlugins];
    gates.push({
      id,
      stack: 'android',
      label: GATE_LABELS[id],
      argv: present ? ['./gradlew', GATE_TASKS[id]] : [],
      cwd: project.root,
      timeoutMs: resolveTimeout(id, options),
      outputMeansFailure: false,
      sandbox: false,
      skipped: present ? null : `плагин ${key} не подключён`,
    });
  }
  // #endregion END_OPTIONAL_GATES

  return gates;
}
