// @file: Turn a detected Go project plus a scope into an ordered, non-mutating gate plan.
// @consumers: golang-plugin
// @tasks: TSK-95

import type { Gate, GatePlanOptions } from '../../stack.types.ts';
import type { GoProject } from './golang-detect.logic.ts';
import type { GoScope } from './golang-scope.logic.ts';

/** Identifier of a built-in golang gate. */
export type GoGateId = 'build' | 'vet' | 'fmt' | 'lint' | 'test' | 'tidy';

/** Order in which golang gates run — cheapest and most diagnostic first. */
export const GO_GATE_ORDER: readonly GoGateId[] = ['build', 'vet', 'fmt', 'lint', 'test', 'tidy'];

/** Human labels for each gate id. */
const GATE_LABELS: Readonly<Record<GoGateId, string>> = {
  build: 'go build',
  vet: 'go vet',
  fmt: 'gofmt -l (check only)',
  lint: 'golangci-lint run',
  test: 'go test',
  tidy: 'go mod tidy -diff',
};

/** Signals that a Go tool failed to do its job — none of them implicate the code under test. */
const GO_ENV_FAIL_PATTERNS: readonly string[] = [
  '^panic: ',
  '^go: .*(?:Forbidden|403|410 Gone|dial tcp|i/o timeout|no such host|connection refused|certificate|module lookup disabled|proxy\\.golang\\.org|unrecognized import path)',
];

/**
 * @purpose Build the shared module-resolution flags so vendored repos never reach the network.
 * @param project Detected project.
 * @returns `-mod=vendor` when the repo vendors its dependencies, otherwise no flags.
 */
function moduleFlags(project: GoProject): string[] {
  // A go.work file takes precedence over vendoring and rejects -mod=vendor outright.
  if (project.workspace !== null) {
    return [];
  }
  return project.vendored ? ['-mod=vendor'] : [];
}

/**
 * @purpose Create a gate that is reported but never executed, with the reason recorded.
 * @param id Gate identifier.
 * @param cwd Working directory the gate would have used.
 * @param reason Why the gate cannot run.
 * @returns A skipped gate carrying the reason.
 */
function skippedGate(id: GoGateId, cwd: string, reason: string): Gate {
  return {
    id,
    stack: 'golang',
    label: GATE_LABELS[id],
    argv: [],
    cwd,
    outputMeansFailure: false,
    skipped: reason,
  };
}

/**
 * @purpose Plan the golang gate list for a project and scope, honouring plugin config.
 * @invariant Gates never mutate the tree: `gofmt -l`, never `go fmt`; `tidy -diff`, never `tidy`.
 * @invariant Emitted gates follow GO_GATE_ORDER; unrunnable gates carry a skip reason.
 * @param project Detected Go project.
 * @param scope Resolved scope determining which packages and files gates apply to.
 * @param options Planning options; `pluginConfig.testTimeout` and `pluginConfig.lintConfig` are honoured.
 * @returns Ordered gate plan.
 */
export function planGoGates(project: GoProject, scope: GoScope, options: GatePlanOptions): Gate[] {
  const go = project.tools.go.bin;
  const gofmt = project.tools.gofmt.bin;
  const linter = project.tools['golangci-lint'].bin;

  const configured = options.pluginConfig ?? {};
  const testTimeout =
    typeof configured['testTimeout'] === 'string' ? configured['testTimeout'] : '10m';
  const lintConfig =
    typeof configured['lintConfig'] === 'string'
      ? configured['lintConfig']
      : project.golangciConfig;
  const includeTidy = options.tidy || configured['tidy'] === true;

  const flags = moduleFlags(project);
  const noPackages = scope.packages.length === 0;
  const gates: Gate[] = [];

  // #region START_GATE_ASSEMBLY — invariant: emitted gates follow GO_GATE_ORDER
  for (const id of GO_GATE_ORDER) {
    if (id === 'tidy' && !includeTidy) {
      continue;
    }

    if (go === null && id !== 'fmt') {
      gates.push(skippedGate(id, project.root, 'go toolchain not found in PATH'));
      continue;
    }

    if (noPackages && id !== 'fmt' && id !== 'tidy') {
      gates.push(skippedGate(id, project.root, `no packages in scope (${scope.note})`));
      continue;
    }

    switch (id) {
      case 'build':
        gates.push({
          id,
          stack: 'golang',
          label: GATE_LABELS[id],
          argv: [go!, 'build', ...flags, ...scope.packages],
          cwd: project.root,
          outputMeansFailure: false,
          envFail: { patterns: GO_ENV_FAIL_PATTERNS },
          skipped: null,
        });
        break;

      case 'vet':
        gates.push({
          id,
          stack: 'golang',
          label: GATE_LABELS[id],
          argv: [go!, 'vet', ...flags, ...scope.packages],
          cwd: project.root,
          outputMeansFailure: false,
          envFail: { patterns: GO_ENV_FAIL_PATTERNS },
          skipped: null,
        });
        break;

      case 'fmt':
        // `gofmt -l` only lists offenders; the rewriting `go fmt` is forbidden as a gate.
        if (gofmt === null) {
          gates.push(skippedGate(id, project.root, 'gofmt not found in PATH'));
        } else if (scope.fmtTargets.length === 0) {
          gates.push(skippedGate(id, project.root, 'no Go files in scope'));
        } else {
          gates.push({
            id,
            stack: 'golang',
            label: GATE_LABELS[id],
            argv: [gofmt, '-l', ...scope.fmtTargets],
            cwd: project.root,
            outputMeansFailure: true,
            skipped: null,
          });
        }
        break;

      case 'lint':
        // Config passed via -c: auto-discovery misses non-dot names like `golangci.yml`.
        if (linter === null) {
          gates.push(
            skippedGate(
              id,
              project.root,
              'golangci-lint not found (PATH or ./bin) — install it, or skip via stack config: stack.golang.skip'
            )
          );
        } else {
          gates.push({
            id,
            stack: 'golang',
            label: `${GATE_LABELS[id]}${lintConfig === null ? ' (default config)' : ''}`,
            argv: [
              linter,
              'run',
              ...(lintConfig !== null ? ['-c', lintConfig] : []),
              ...scope.packages,
            ],
            cwd: project.root,
            outputMeansFailure: false,
            // golangci-lint reserves exit 1 for findings; anything above is the tool breaking.
            envFail: { exitAbove: 1, patterns: GO_ENV_FAIL_PATTERNS },
            skipped: null,
          });
        }
        break;

      case 'test':
        gates.push({
          id,
          stack: 'golang',
          label: GATE_LABELS[id],
          argv: [go!, 'test', `-timeout=${testTimeout}`, ...flags, ...scope.packages],
          cwd: project.root,
          outputMeansFailure: false,
          envFail: { patterns: GO_ENV_FAIL_PATTERNS },
          skipped: null,
        });
        break;

      case 'tidy':
        gates.push({
          id,
          stack: 'golang',
          label: GATE_LABELS[id],
          argv: [go!, 'mod', 'tidy', '-diff'],
          cwd: project.modules[0]?.dir ?? project.root,
          outputMeansFailure: true,
          envFail: { patterns: GO_ENV_FAIL_PATTERNS },
          skipped: null,
        });
        break;
    }
  }
  // #endregion END_GATE_ASSEMBLY

  return gates;
}
