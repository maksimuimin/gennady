// @file: StackPlugin implementation for npm repositories — gates from classified package.json scripts.
// @consumers: stack-registry
// @tasks: TSK-95

import fs from 'node:fs';
import path from 'node:path';
import type {
  Gate,
  GatePlanOptions,
  ScopeRequest,
  StackDetection,
  StackPlugin,
  StackScope,
} from '../../stack.types.ts';
import {
  classifyNpmScripts,
  NPM_SCRIPT_CLASSES,
  type NpmScriptClass,
} from './classify-npm-scripts.ts';

/**
 * @purpose Detection payload of the node plugin.
 * @consumer node-plugin (internal)
 */
type NodeProject = {
  /** @purpose Absolute repository root. */
  readonly root: string;
  /** @purpose Package name from package.json, when present. */
  readonly packageName: string;
  /** @purpose Selected npm script per verification class. */
  readonly selected: Partial<Record<NpmScriptClass, string>>;
};

/**
 * @purpose Parse package.json at root, returning null on absence or malformed JSON.
 * @param root Absolute repository root.
 * @returns Parsed content, or null.
 */
function readPackageJson(root: string): { name?: string; scripts?: Record<string, string> } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

/**
 * @purpose StackPlugin for npm repositories: package.json detection, gates from classified scripts.
 * @implements {StackPlugin} in specs/stack/stack.spec.md
 * @invariant Gates are repo-level npm scripts; positional targets do not narrow them (D-STACK-006).
 * @consumer stack-registry
 */
export const nodePlugin: StackPlugin = {
  id: 'node',

  detect(root: string): StackDetection | null {
    const pkg = readPackageJson(root);
    if (pkg === null) {
      return null;
    }

    const selected = classifyNpmScripts(pkg.scripts ?? {});
    const project: NodeProject = { root, packageName: pkg.name ?? '(unnamed)', selected };
    const gateList = NPM_SCRIPT_CLASSES.filter((cls) => selected[cls] !== undefined)
      .map((cls) => `${cls}→${selected[cls]}`)
      .join(', ');

    return {
      stack: 'node',
      root,
      summary: [
        `package:   ${project.packageName}`,
        `scripts:   ${gateList.length > 0 ? gateList : '(no verification scripts discovered)'}`,
      ],
      diagnostics:
        gateList.length > 0
          ? []
          : [
              {
                code: 'NODE_NO_SCRIPTS',
                message: 'package.json has no scripts classifiable as verification gates.',
                fix: 'Add test/lint/typecheck scripts, or declare gates via .gennadyrc stack.node.extraGates.',
              },
            ],
      details: project,
    };
  },

  resolveScope(detection: StackDetection, request: ScopeRequest): StackScope {
    const project = detection.details as NodeProject;
    const selectedNames = Object.values(project.selected);
    // npm scripts are repo-level commands; explicit targets cannot narrow them (D-STACK-006).
    return {
      mode: request.mode,
      note: `npm scripts (${selectedNames.length > 0 ? selectedNames.join(', ') : 'none'}), repo-wide`,
      details: project,
    };
  },

  planGates(detection: StackDetection, _scope: StackScope, _options: GatePlanOptions): Gate[] {
    const project = detection.details as NodeProject;

    return NPM_SCRIPT_CLASSES.filter((cls) => project.selected[cls] !== undefined).map((cls) => ({
      id: cls,
      stack: 'node',
      label: `npm run ${project.selected[cls]!}`,
      argv: ['npm', 'run', project.selected[cls]!],
      cwd: project.root,
      outputMeansFailure: false,
      skipped: null,
    }));
  },
};
