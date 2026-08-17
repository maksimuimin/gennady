// @file: Load the `stack` section of .gennadyrc and apply its overrides to a gate plan.
// @consumers: verify.cmd, stack-registry
// @tasks: TSK-95

import path from 'node:path';
import { GennadyRc } from '../../shared/backend/rc/rc-config.ts';
import type {
  ExtraGateSpec,
  Gate,
  GateOverride,
  StackConfig,
  StackDiagnostic,
  StackId,
  StackPluginConfig,
} from './stack.types.ts';

/**
 * @purpose Result of loading the stack config: parsed section plus any load-time diagnostics.
 * @consumer verify.cmd
 */
export type StackConfigLoad = {
  /** @purpose Parsed `stack` section, or null when absent or invalid. */
  readonly config: StackConfig | null;
  /** @purpose Load-time problems; an invalid config degrades to auto-detection, never a crash. */
  readonly diagnostics: readonly StackDiagnostic[];
};

/**
 * Committable project config filename. `.gennadyrc` is conventionally gitignored
 * because its `models` section can carry API keys; repo-shared stack config
 * therefore lives in this file, with `.gennadyrc` acting as a personal override.
 */
const PROJECT_CONFIG_FILENAME = 'gennady.config.json';

/**
 * @purpose Load the `stack` section: personal .gennadyrc → committed gennady.config.json → HOME.
 * @invariant A missing file or missing section is valid; a broken one yields a diagnostic.
 * @invariant First file carrying a `stack` section wins — no deep merging across files.
 * @param root Absolute repository root to look in before HOME.
 * @returns Parsed config with diagnostics; config is null when nothing usable was found.
 * @sideEffect IO: reads config files.
 */
export function loadStackConfig(root: string): StackConfigLoad {
  const diagnostics: StackDiagnostic[] = [];

  const candidates: Array<{ dir: string; name: string }> = [
    { dir: root, name: GennadyRc.DEFAULT_FILENAME },
    { dir: root, name: PROJECT_CONFIG_FILENAME },
    { dir: process.env['HOME'] ?? '', name: GennadyRc.DEFAULT_FILENAME },
  ];

  // #region START_CONFIG_LOOKUP — invariant: personal rc wins over project file wins over HOME
  for (const { dir, name } of candidates) {
    if (dir.length === 0) {
      continue;
    }

    const rc = new GennadyRc(dir, name);
    if (!rc.isValid()) {
      diagnostics.push({
        code: 'STACK_CONFIG_INVALID',
        message: `${name} in ${dir} could not be parsed: ${rc.getError()?.message ?? 'unknown error'}`,
        fix: 'Fix the JSON; verify continues with auto-detection and built-in gates.',
      });
      continue;
    }

    const section = rc.getStack();
    if (section === undefined) {
      continue;
    }
    if (section === null || typeof section !== 'object' || Array.isArray(section)) {
      diagnostics.push({
        code: 'STACK_CONFIG_INVALID',
        message: `${name} in ${dir}: "stack" must be an object`,
        fix: 'See specs/stack/stack.spec.md §6 for the schema; section ignored.',
      });
      continue;
    }

    return { config: section as StackConfig, diagnostics };
  }
  // #endregion END_CONFIG_LOOKUP

  return { config: null, diagnostics };
}

/**
 * @purpose Extract one plugin's config slice, tolerating absent or malformed sections.
 * @param config Parsed stack config, or null.
 * @param pluginId Plugin to extract the slice for.
 * @returns The plugin's config object, or null when absent or not an object.
 */
export function pluginConfigOf(
  config: StackConfig | null,
  pluginId: StackId
): StackPluginConfig | null {
  const slice = config?.[pluginId];
  if (slice === null || slice === undefined || typeof slice !== 'object' || Array.isArray(slice)) {
    return null;
  }
  return slice as StackPluginConfig;
}

/**
 * @purpose Build a gate from an extraGates entry, defaulting cwd to root and contract to exit-code.
 * @param spec Config entry.
 * @param stack Plugin the gate is attributed to.
 * @param root Absolute repository root.
 * @returns Executable gate.
 */
function extraGateToGate(spec: ExtraGateSpec, stack: StackId, root: string): Gate {
  return {
    id: spec.id,
    stack,
    label: `${spec.argv.join(' ')} (from .gennadyrc)`,
    argv: spec.argv,
    cwd: spec.cwd !== undefined ? path.resolve(root, spec.cwd) : root,
    outputMeansFailure: spec.outputMeansFailure ?? false,
    skipped: null,
  };
}

/**
 * @purpose Apply one override to a gate; unset override fields inherit the original gate.
 * @param gate Built-in gate being overridden.
 * @param override Config override.
 * @param root Absolute repository root that a relative override cwd resolves against.
 * @returns The overridden gate, no longer skipped (an explicit override is a directive to run).
 */
function overrideGate(gate: Gate, override: GateOverride, root: string): Gate {
  return {
    ...gate,
    argv: override.argv ?? gate.argv,
    cwd: override.cwd !== undefined ? path.resolve(root, override.cwd) : gate.cwd,
    outputMeansFailure: override.outputMeansFailure ?? gate.outputMeansFailure,
    label: `${gate.label} (overridden by .gennadyrc)`,
    // An explicit argv override supersedes a planner skip (e.g. tool-not-found):
    // the config author states the command is runnable in this repo.
    skipped: override.argv !== undefined ? null : gate.skipped,
  };
}

/**
 * @purpose Apply a plugin's config slice to its planned gates per FR-STACK-05.
 * @invariant Application order: gates-overrides → skip → extraGates. Built-in order is preserved.
 * @param gates Gate plan produced by the plugin.
 * @param pluginConfig The plugin's config slice, or null for a pass-through.
 * @param stack Plugin id, used to attribute extra gates.
 * @param root Absolute repository root.
 * @returns The effective gate list.
 */
export function applyStackConfig(
  gates: readonly Gate[],
  pluginConfig: StackPluginConfig | null,
  stack: StackId,
  root: string
): Gate[] {
  if (pluginConfig === null) {
    return [...gates];
  }

  const overrides = pluginConfig.gates ?? {};
  const skip = new Set(pluginConfig.skip ?? []);

  const effective = gates
    .map((gate) => {
      const override = overrides[gate.id];
      return override !== undefined ? overrideGate(gate, override, root) : gate;
    })
    .filter((gate) => !skip.has(gate.id));

  for (const spec of pluginConfig.extraGates ?? []) {
    if (Array.isArray(spec.argv) && spec.argv.length > 0 && typeof spec.id === 'string') {
      effective.push(extraGateToGate(spec, stack, root));
    }
  }

  return effective;
}
