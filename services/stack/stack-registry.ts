// @file: Registry of built-in stack plugins and stack detection across the registry.
// @consumers: verify.cmd
// @tasks: TSK-95

import type { StackConfig, StackDetection, StackDiagnostic, StackPlugin } from './stack.types.ts';
import { nodePlugin } from './plugins/node/node-plugin.ts';
import { golangPlugin } from './plugins/golang/golang-plugin.ts';

/** Built-in stack plugins in detection order. External plugin loading is out of scope (D-STACK-001). */
export const BUILTIN_STACK_PLUGINS: readonly StackPlugin[] = [nodePlugin, golangPlugin];

/**
 * @purpose Result of running detection across the registry.
 * @consumer verify.cmd
 */
export type StackDetectionRun = {
  /** @purpose Plugins that recognized the repository, paired with their detections. */
  readonly active: readonly { plugin: StackPlugin; detection: StackDetection }[];
  /** @purpose Registry-level problems, e.g. an unknown id in `stack.use`. */
  readonly diagnostics: readonly StackDiagnostic[];
};

/**
 * @purpose Detect which stacks a repository belongs to, honouring the config's `use` restriction.
 * @invariant `use` restricts the candidate set; detection still decides. Unknown ids are
 *   diagnosed, never silently ignored (FR-STACK-04).
 * @param root Absolute repository root.
 * @param config Parsed stack config, or null for pure auto-detection.
 * @param [registry] Registry to detect against; defaults to the built-ins.
 * @returns Active plugin+detection pairs plus registry-level diagnostics.
 */
export function detectStacks(
  root: string,
  config: StackConfig | null,
  registry?: readonly StackPlugin[]
): StackDetectionRun {
  const plugins = registry ?? BUILTIN_STACK_PLUGINS;
  const diagnostics: StackDiagnostic[] = [];
  let candidates = plugins;

  // #region START_USE_RESTRICTION — invariant: unknown ids in `use` are diagnosed, not dropped silently
  const use = config?.use;
  if (Array.isArray(use)) {
    const known = new Set(plugins.map((plugin) => plugin.id));
    for (const id of use) {
      if (!known.has(id as StackPlugin['id'])) {
        diagnostics.push({
          code: 'STACK_USE_UNKNOWN',
          message: `.gennadyrc stack.use names unknown plugin "${id}"`,
          fix: `Known plugins: ${[...known].join(', ')}. Fix the id or remove it.`,
        });
      }
    }
    candidates = plugins.filter((plugin) => use.includes(plugin.id));
  }
  // #endregion END_USE_RESTRICTION

  const active: { plugin: StackPlugin; detection: StackDetection }[] = [];
  for (const plugin of candidates) {
    const detection = plugin.detect(root);
    if (detection !== null) {
      active.push({ plugin, detection });
    }
  }

  return { active, diagnostics };
}
