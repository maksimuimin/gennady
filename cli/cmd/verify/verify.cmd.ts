// @file: verify command — stack-agnostic verification: detect stacks, plan gates, run, report.
// @consumers: gennady.ts, verify/index.ts
// @tasks: TSK-96

/**
 * npx gennady verify                       gates for changes vs the base branch, all detected stacks
 * npx gennady verify ./internal/foo        gates for explicit files or directories
 * npx gennady verify --all                 whole-repo gates
 * npx gennady verify --plan                show detection + plan without running anything
 * npx gennady verify --json                machine-readable detection + plan + results
 * npx gennady verify --only=lint,test      run a subset of gates
 * npx gennady verify --skip=lint           drop gates from the plan
 * npx gennady verify --stack=golang        restrict to one stack plugin
 */

import path from 'node:path';
import { parseArgs } from '../../../shared/common/parse-args.ts';
import { BUILTIN_STACK_PLUGINS, detectStacks } from '../../../services/stack/stack-registry.ts';
import {
  applyStackConfig,
  loadStackConfig,
  pluginConfigOf,
} from '../../../services/stack/stack-config.ts';
import { formatVerifyReport, runVerify } from '../../../services/stack/gate-runner.ts';
import type {
  ScopeRequest,
  StackDiagnostic,
  StackRun,
} from '../../../services/stack/stack.types.ts';

/** Exit code: one or more gates failed. */
const EXIT_GATES_FAILED = 1;
/** Exit code: bad invocation (unknown gate or stack id). */
const EXIT_BAD_INVOCATION = 4;
/** Exit code: no stack plugin recognized the repository. */
const EXIT_NO_STACK = 5;

/** Default per-gate wall-clock budget in milliseconds. */
const DEFAULT_GATE_TIMEOUT_MS = 900_000;

/**
 * @purpose Parse a comma-separated list option into trimmed entries.
 * @param raw Raw option value, or undefined when the flag was absent.
 * @returns Entries, empty when the flag was absent.
 */
function parseList(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * @purpose Run the verify command end-to-end and return the process exit code.
 * @param argv Full process argv.
 * @returns Exit code per the contract: 0 pass · 1 gate failed · 4 bad invocation · 5 no stack.
 * @sideEffect Process: executes verification gates; IO: reads .gennadyrc; Logs: report to stdout/stderr.
 */
export async function run(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    all: ['all'],
    changed: ['changed'],
    plan: ['plan', 'dry-run'],
    json: ['json'],
    only: { aliases: ['only'], takesValue: true },
    skip: { aliases: ['skip'], takesValue: true },
    stack: { aliases: ['stack'], takesValue: true },
    tidy: ['tidy'],
    root: { aliases: ['root'], takesValue: true },
    timeout: { aliases: ['timeout'], takesValue: true },
    help: ['help', 'h'],
  });

  if (args.help === true) {
    const { printHelp } = await import('./help.ts');
    printHelp();
    return 0;
  }

  const only = parseList(args.only);
  const skip = parseList(args.skip);
  const root = path.resolve(typeof args.root === 'string' ? args.root : process.cwd());
  const positional = (args._ as string[]).filter((arg) => arg !== 'verify');

  // #region START_CONFIG_AND_DETECT — config restricts and parameterises; detection decides
  const configLoad = loadStackConfig(root);
  const cliStackFilter = parseList(args.stack);

  if (cliStackFilter.some((id) => !BUILTIN_STACK_PLUGINS.some((plugin) => plugin.id === id))) {
    console.error(
      `[verify] BAD_INVOCATION: --stack names unknown plugin(s): ${cliStackFilter.join(', ')}\n` +
        `  known stacks: ${BUILTIN_STACK_PLUGINS.map((plugin) => plugin.id).join(', ')}`
    );
    return EXIT_BAD_INVOCATION;
  }

  const effectiveConfig =
    cliStackFilter.length > 0
      ? { ...(configLoad.config ?? {}), use: cliStackFilter }
      : configLoad.config;

  const detectionRun = detectStacks(root, effectiveConfig);
  const diagnostics: StackDiagnostic[] = [
    ...configLoad.diagnostics,
    ...detectionRun.diagnostics,
    ...detectionRun.active.flatMap((entry) => entry.detection.diagnostics),
  ];

  if (detectionRun.active.length === 0) {
    console.error(`[verify] NO_STACK_DETECTED: no stack plugin recognized ${root}`);
    console.error(`  known stacks: node (package.json), golang (go.mod)`);
    console.error(
      '  fix: run from a project root, pass --root=<path>, or declare stack.use in .gennadyrc'
    );
    return EXIT_NO_STACK;
  }
  // #endregion END_CONFIG_AND_DETECT

  const request: ScopeRequest = {
    mode: positional.length > 0 ? 'files' : args.all === true ? 'all' : 'changed',
    targets: positional,
  };

  // #region START_PLAN — plugin plans built-ins, config overrides/extends, CLI only/skip filters last
  const runs: StackRun[] = detectionRun.active.map(({ plugin, detection }) => {
    const scope = plugin.resolveScope(detection, request);
    const pluginConfig = pluginConfigOf(effectiveConfig, plugin.id);
    const planned = plugin.planGates(detection, scope, { tidy: args.tidy === true, pluginConfig });
    const configured = applyStackConfig(planned, pluginConfig, plugin.id, root);
    return { detection, scope, gates: configured };
  });

  const knownGateIds = new Set(runs.flatMap((run) => run.gates.map((gate) => gate.id)));
  const unknown = [...only, ...skip].filter((id) => !knownGateIds.has(id));
  if (unknown.length > 0) {
    console.error(
      `[verify] BAD_INVOCATION: --only/--skip name unknown gate(s): ${unknown.join(', ')}\n` +
        `  gates in this plan: ${[...knownGateIds].join(', ')}`
    );
    return EXIT_BAD_INVOCATION;
  }

  const filteredRuns: StackRun[] = runs.map((run) => ({
    ...run,
    gates: run.gates.filter(
      (gate) => !skip.includes(gate.id) && (only.length === 0 || only.includes(gate.id))
    ),
  }));
  // #endregion END_PLAN

  if (args.plan === true) {
    if (args.json === true) {
      console.log(JSON.stringify({ root, diagnostics, runs: filteredRuns }, null, 2));
      return 0;
    }

    console.info(
      `[verify] plan for ${root} (stacks: ${filteredRuns.map((run) => run.detection.stack).join(', ')})`
    );
    for (const stackRun of filteredRuns) {
      for (const line of stackRun.detection.summary) {
        console.info(`  ${line}`);
      }
      console.info(`  scope:     ${stackRun.scope.mode} — ${stackRun.scope.note}`);
    }
    for (const diagnostic of diagnostics) {
      console.info('');
      console.info(`  ⚠️  ${diagnostic.code}: ${diagnostic.message}`);
      console.info(`      fix: ${diagnostic.fix}`);
    }
    console.info('');
    for (const stackRun of filteredRuns) {
      for (const gate of stackRun.gates) {
        const name = `${gate.stack}:${gate.id}`;
        console.info(
          gate.skipped !== null
            ? `  ⏭️  ${name.padEnd(14)} skip — ${gate.skipped}`
            : `  ▶️  ${name.padEnd(14)} ${gate.argv.join(' ')}`
        );
      }
    }
    return 0;
  }

  const timeoutMs =
    typeof args.timeout === 'string'
      ? Number.parseInt(args.timeout, 10) * 1000
      : DEFAULT_GATE_TIMEOUT_MS;

  const report = runVerify(filteredRuns, diagnostics, timeoutMs);

  if (args.json === true) {
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          passed: report.passed,
          total: report.total,
          diagnostics: report.diagnostics,
          runs: report.runs.map((run) => ({
            stack: run.detection.stack,
            summary: run.detection.summary,
            scope: { mode: run.scope.mode, note: run.scope.note },
          })),
          results: report.results.map((result) => ({
            stack: result.gate.stack,
            id: result.gate.id,
            command: result.gate.argv.join(' '),
            status: result.status,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            output: result.output,
          })),
        },
        null,
        2
      )
    );
    return report.ok ? 0 : EXIT_GATES_FAILED;
  }

  console.log(formatVerifyReport(report));
  return report.ok ? 0 : EXIT_GATES_FAILED;
}
