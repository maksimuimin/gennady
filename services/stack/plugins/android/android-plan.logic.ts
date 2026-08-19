// @file: Gate plan for Android/Gradle projects — assemble → lint → test + optional ktlint/detekt/spotless.
// @consumers: android-plugin, stack-config (gate id list)
// @tasks: TSK-97, TSK-98

import type { EnvFailPredicate, Gate, GatePlanOptions } from '../../stack.types.ts';
import { outputMatches } from '../../gate-runner.ts';
import { parseDuration } from '../../stack-config.ts';
import type { AndroidProject } from './android-detect.logic.ts';

// #region START_ENV_FAIL_PREDICATES — D-STACK-019: env-fail on typical mobile env conditions

const JDK_SKEW_RE = /Unsupported class file major version|requires Java \d+ to run|Minimum supported Gradle version is/;

const DAEMON_CRASH_RE = /Gradle build daemon disappeared|The daemon has stopped unexpectedly/;

const REGISTRY_BLOCKED_RE = /Could not (?:resolve|GET|download|find)|dial tcp.*(?:i\/o timeout|no such host|connection refused)|Received status code 4\d\d/;

const KOTLIN_COMPILER_CRASH_RE = /KotlinFrontEndException|Internal compiler error/;

/** Predicates for assemble/lint/ktlint/detekt/spotless — tool env failures, not code (D-STACK-019). */
const ANDROID_TOOL_ENV_FAIL: readonly EnvFailPredicate[] = [
  outputMatches(
    JDK_SKEW_RE,
    'JDK incompatible with AGP/Gradle — install a compatible JDK or set toolchain in build.gradle{.kts}',
  ),
  outputMatches(
    DAEMON_CRASH_RE,
    'Gradle daemon crashed (JVM crash / OOM) — increase -Xmx in gradle.properties; do NOT edit source in response',
  ),
  outputMatches(
    REGISTRY_BLOCKED_RE,
    'Maven/Gradle registry unreachable — unblock corporate proxy, or skip via stack.android.skipGates',
  ),
  outputMatches(
    KOTLIN_COMPILER_CRASH_RE,
    'Kotlin compiler panic — this is a toolchain bug, not source code; upgrade Kotlin or report to JetBrains',
  ),
];

/** Predicates for test — same as tool, minus compiler-panic (test-code AssertionError is genuine FAIL, D-STACK-019). */
const ANDROID_TEST_ENV_FAIL: readonly EnvFailPredicate[] = [
  outputMatches(
    JDK_SKEW_RE,
    'JDK incompatible with AGP/Gradle — install a compatible JDK or set toolchain in build.gradle{.kts}',
  ),
  outputMatches(
    DAEMON_CRASH_RE,
    'Gradle daemon crashed (JVM crash / OOM) — increase -Xmx in gradle.properties; do NOT edit source in response',
  ),
  outputMatches(
    REGISTRY_BLOCKED_RE,
    'Maven/Gradle registry unreachable — unblock corporate proxy, or skip via stack.android.skipGates',
  ),
];

// #endregion END_ENV_FAIL_PREDICATES

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
 * @invariant Base executable; optional skipped when plugin absent (§3.6 step 5);
 *   envFail per D-STACK-019 (TEST subset on test); skipped gates carry no envFail.
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
      envFail: id === 'test' ? ANDROID_TEST_ENV_FAIL : ANDROID_TOOL_ENV_FAIL,
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
      envFail: present ? ANDROID_TOOL_ENV_FAIL : undefined,
      skipped: present ? null : `плагин ${key} не подключён`,
    });
  }
  // #endregion END_OPTIONAL_GATES

  return gates;
}
