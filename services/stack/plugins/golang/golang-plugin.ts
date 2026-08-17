// @file: StackPlugin implementation for Go repositories — wires detect, scope and plan.
// @consumers: stack-registry
// @tasks: TSK-95

import path from 'node:path';
import type {
  Gate,
  GatePlanOptions,
  ScopeRequest,
  StackDetection,
  StackPlugin,
  StackScope,
} from '../../stack.types.ts';
import { detectGoProject, type GoProject } from './golang-detect.logic.ts';
import { resolveGoScope, type GoScope } from './golang-scope.logic.ts';
import { planGoGates } from './golang-plan.logic.ts';

/**
 * @purpose Build the `key: value` summary lines shown by `verify --plan` for a Go project.
 * @param project Detected project.
 * @returns Human-readable summary lines.
 */
function summarize(project: GoProject): string[] {
  const primary = project.modules[0];
  const lines = [
    `module:    ${primary?.path ?? '(unknown)'} (go ${primary?.goVersion || '?'})`,
    `workspace: ${project.workspace ?? '(none)'}`,
    `vendored:  ${project.vendored}`,
    `config:    ${project.golangciConfig ?? '(none found — golangci-lint would use its defaults)'}`,
  ];

  if (project.modules.length > 1) {
    const nested = project.modules
      .slice(1)
      .map((module) => path.relative(project.root, module.dir) || '.');
    lines.splice(1, 0, `nested:    ${nested.join(', ')}`);
  }
  if (project.makeTargets.length > 0) {
    const shown = project.makeTargets.slice(0, 8);
    const more = project.makeTargets.length - shown.length;
    lines.push(`make:      ${shown.join(', ')}${more > 0 ? ` … (+${more} more)` : ''}`);
  }

  return lines;
}

/**
 * @purpose StackPlugin for Go repositories: go.mod detection, changed-package scoping,
 *   non-mutating gates (build, vet, gofmt -l, golangci-lint, go test, tidy -diff).
 * @implements {StackPlugin} in specs/stack/stack.spec.md
 * @invariant detect() runs no processes beyond the golangci-lint version probe.
 * @consumer stack-registry
 */
export const golangPlugin: StackPlugin = {
  id: 'golang',

  detect(root: string): StackDetection | null {
    const project = detectGoProject(root);
    if (project.modules.length === 0) {
      return null;
    }

    return {
      stack: 'golang',
      root,
      summary: summarize(project),
      diagnostics: project.diagnostics,
      details: project,
    };
  },

  resolveScope(detection: StackDetection, request: ScopeRequest): StackScope {
    const scope = resolveGoScope(detection.details as GoProject, request);
    return { mode: scope.mode, note: scope.note, details: scope };
  },

  planGates(detection: StackDetection, scope: StackScope, options: GatePlanOptions): Gate[] {
    return planGoGates(detection.details as GoProject, scope.details as GoScope, options);
  },
};
