// @file: StackPlugin implementation for Android/Gradle projects — composite detection + repo-level plan.
// @consumers: stack-registry
// @tasks: TSK-97

import type { StackDetection, StackPlugin } from '../../stack.types.ts';
import { detectAndroid, type AndroidProject } from './android-detect.logic.ts';
import { planAndroidGates } from './android-plan.logic.ts';

/**
 * @purpose StackPlugin for Android/Gradle repos — canonical wrapper layout + AGP in root or
 *   first 32 submodules (spec §3.6).
 * @implements {StackPlugin} in specs/stack/stack.spec.md
 * @invariant Detection reads files only; no `./gradlew` spawned (D-STACK-017).
 * @invariant Gates are Gradle tasks; positional targets cannot narrow them (D-STACK-006).
 * @consumer stack-registry
 */
export const androidPlugin: StackPlugin = {
  id: 'android',
  marker: 'settings.gradle{.kts}',
  description: 'Gradle Android project (AGP + wrapper)',
  // Gradle config-cache and K2 incremental metadata live in `.gradle` / `.kotlin` — the stack's
  // execution environment, not tree state; linked into the run replica (D-STACK-013, D-STACK-016).
  sandboxLinks: ['.gradle', '.kotlin'],

  detect(root: string): StackDetection | null {
    return detectAndroid(root).detection;
  },

  verify: {
    resolveScope(detection, _request) {
      const project = detection.details as AndroidProject;
      // Gradle tasks are repo-level; explicit targets cannot narrow them (D-STACK-006).
      const holder = project.agpHolderModule.length > 0 ? `:${project.agpHolderModule}` : '(root)';
      return {
        mode: _request.mode,
        note: `Gradle tasks (holder ${holder}), repo-wide`,
        details: project,
      };
    },

    planGates(detection, _scope, options) {
      return planAndroidGates(detection.details as AndroidProject, options);
    },
  },
};
