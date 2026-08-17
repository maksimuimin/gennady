// @file: Closed-world types of the stack plugin system — plugin interface, gates, config, report.
// @consumers: stack-registry, stack-config, gate-runner, node-plugin, golang-plugin, verify.cmd
// @tasks: TSK-95

/** Identifier of a built-in stack plugin. */
export type StackId = 'node' | 'golang';

/**
 * @purpose An environment problem surfaced before any gate runs — actionable, never silent.
 * @consumer gate-runner, verify.cmd
 */
export type StackDiagnostic = {
  /** @purpose Stable machine-readable identifier of the problem. */
  readonly code: string;
  /** @purpose What is wrong. */
  readonly message: string;
  /** @purpose Concrete action that resolves it. */
  readonly fix: string;
};

/**
 * @purpose Result of a plugin recognizing a repository as its stack.
 * @consumer stack-registry, verify.cmd
 */
export type StackDetection = {
  /** @purpose Which plugin produced this detection. */
  readonly stack: StackId;
  /** @purpose Absolute repository root the detection applies to. */
  readonly root: string;
  /** @purpose Human-readable `key: value` lines shown by `verify --plan`. */
  readonly summary: readonly string[];
  /** @purpose Environment problems found during detection. */
  readonly diagnostics: readonly StackDiagnostic[];
  /** @purpose Plugin-owned payload threaded back into resolveScope/planGates. */
  readonly details: unknown;
};

/**
 * @purpose How the operator asked to narrow the run.
 * @consumer verify.cmd, plugins
 */
export type ScopeRequest = {
  /** @purpose Scoping strategy: explicit targets, changed-vs-base, or whole repo. */
  readonly mode: 'files' | 'changed' | 'all';
  /** @purpose Explicit file or directory targets; only meaningful in `files` mode. */
  readonly targets: readonly string[];
};

/**
 * @purpose A plugin's resolved scope for one run.
 * @consumer verify.cmd, plugins
 */
export type StackScope = {
  /** @purpose Scoping strategy that was actually applied. */
  readonly mode: ScopeRequest['mode'];
  /** @purpose Human-readable note explaining how the scope was derived. */
  readonly note: string;
  /** @purpose Plugin-owned payload threaded into planGates. */
  readonly details: unknown;
};

/**
 * @purpose Declarative rules for classifying a gate failure as an environment failure.
 * @consumer gate-runner
 */
export type GateEnvFailRule = {
  /** @purpose Exit codes strictly above this value implicate the tool, not the code. */
  readonly exitAbove?: number;
  /** @purpose Multiline regex sources; any match in the output implicates the environment. */
  readonly patterns?: readonly string[];
};

/**
 * @purpose A planned verification gate — pure data, executed without a shell by the runner.
 * @consumer gate-runner, stack-config, verify.cmd
 */
export type Gate = {
  /** @purpose Gate identifier, unique within its stack (e.g. `build`, `lint`). */
  readonly id: string;
  /** @purpose Stack the gate belongs to; rendered as `stack:id` in reports. */
  readonly stack: StackId;
  /** @purpose Short human label shown in reports. */
  readonly label: string;
  /** @purpose argv, executed without a shell. Empty when skipped. */
  readonly argv: readonly string[];
  /** @purpose Working directory for the gate. */
  readonly cwd: string;
  /** @purpose When true, any stdout on exit 0 means failure (gofmt -l contract). */
  readonly outputMeansFailure: boolean;
  /** @purpose Env-fail classification rules; absent means every failure implicates the code. */
  readonly envFail?: GateEnvFailRule;
  /** @purpose Populated when the gate cannot run; it is then reported, not executed. */
  readonly skipped: string | null;
};

/**
 * @purpose Outcome of executing one gate. `fail` implicates the code; `env-fail` implicates
 *   the environment and must never trigger source edits.
 * @consumer gate-runner, verify.cmd
 */
export type GateResult = {
  /** @purpose The gate that produced this result. */
  readonly gate: Gate;
  /** @purpose Verdict of the execution. */
  readonly status: 'pass' | 'fail' | 'env-fail' | 'skipped' | 'timeout';
  /** @purpose Process exit code, or null when skipped or killed. */
  readonly exitCode: number | null;
  /** @purpose Wall-clock duration in milliseconds. */
  readonly durationMs: number;
  /** @purpose Combined stdout+stderr, retained only for non-passing gates. */
  readonly output: string;
};

/**
 * @purpose One stack's contribution to a verify run: detection, scope and gate plan.
 * @consumer gate-runner, verify.cmd
 */
export type StackRun = {
  /** @purpose Detection the plan was derived from. */
  readonly detection: StackDetection;
  /** @purpose Scope the gates apply to. */
  readonly scope: StackScope;
  /** @purpose Ordered gate plan after config application. */
  readonly gates: readonly Gate[];
};

/**
 * @purpose Aggregate result of a full verify run across all active stacks.
 * @consumer verify.cmd
 */
export type VerifyReport = {
  /** @purpose Per-stack runs in detection order. */
  readonly runs: readonly StackRun[];
  /** @purpose Config-level and detection-level diagnostics, deduplicated. */
  readonly diagnostics: readonly StackDiagnostic[];
  /** @purpose Per-gate results in plan order. */
  readonly results: readonly GateResult[];
  /** @purpose Number of executed gates that passed. */
  readonly passed: number;
  /** @purpose Number of gates actually executed; skipped gates are excluded. */
  readonly total: number;
  /** @purpose True only when every executed gate passed. */
  readonly ok: boolean;
};

/**
 * @purpose Options a plugin receives when planning gates.
 * @consumer plugins, verify.cmd
 */
export type GatePlanOptions = {
  /** @purpose Include opt-in slow gates (golang: `go mod tidy -diff`). */
  readonly tidy: boolean;
  /** @purpose Plugin-specific slice of the stack config (`.gennadyrc#stack.<id>`), if any. */
  readonly pluginConfig: StackPluginConfig | null;
};

/**
 * @purpose Override of a built-in gate from `.gennadyrc`; unset fields inherit the original.
 * @consumer stack-config
 */
export type GateOverride = {
  /** @purpose Replacement argv. */
  readonly argv?: readonly string[];
  /** @purpose Replacement working directory, relative to the repo root. */
  readonly cwd?: string;
  /** @purpose Replacement stdout contract. */
  readonly outputMeansFailure?: boolean;
};

/**
 * @purpose A repo-specific gate appended after the built-ins.
 * @consumer stack-config
 */
export type ExtraGateSpec = {
  /** @purpose Gate identifier, unique within the plugin's plan. */
  readonly id: string;
  /** @purpose argv, executed without a shell. */
  readonly argv: readonly string[];
  /** @purpose Working directory relative to the repo root; defaults to the root. */
  readonly cwd?: string;
  /** @purpose Stdout contract; defaults to false (exit code decides). */
  readonly outputMeansFailure?: boolean;
};

/**
 * @purpose Per-plugin section of the stack config; plugin-specific keys pass through untouched.
 * @consumer stack-config, plugins
 */
export type StackPluginConfig = {
  /** @purpose Gate ids to drop from the plan. */
  readonly skip?: readonly string[];
  /** @purpose Overrides of built-in gates, keyed by gate id. */
  readonly gates?: Readonly<Record<string, GateOverride>>;
  /** @purpose Repo-specific gates appended after the built-ins. */
  readonly extraGates?: readonly ExtraGateSpec[];
  /** @purpose Plugin-specific keys (golang: testTimeout, lintConfig, tidy). */
  readonly [key: string]: unknown;
};

/**
 * @purpose The `stack` section of `.gennadyrc`.
 * @consumer stack-config, stack-registry
 */
export type StackConfig = {
  /** @purpose Restrict the plugin registry to these ids; default is full auto-detection. */
  readonly use?: readonly string[];
  /** @purpose Per-plugin configuration, keyed by plugin id. */
  readonly [pluginId: string]: unknown;
};

/**
 * @purpose Common interface every stack implements — the stack is a detail behind it.
 * @invariant No operation mutates the working tree; detect may only run short probe commands.
 * @consumer stack-registry, verify.cmd
 */
export type StackPlugin = {
  /** @purpose Unique plugin identifier. */
  readonly id: StackId;
  /**
   * @purpose Recognize a repository; null when it does not belong to this stack.
   * @param root Absolute repository root.
   * @returns Detection payload, or null.
   */
  detect(root: string): StackDetection | null;
  /**
   * @purpose Narrow a run to the packages/files the request covers.
   * @param detection Detection previously produced by this plugin.
   * @param request Operator's scoping request.
   * @returns Resolved scope.
   */
  resolveScope(detection: StackDetection, request: ScopeRequest): StackScope;
  /**
   * @purpose Plan the ordered, non-mutating gate list for a scope.
   * @param detection Detection previously produced by this plugin.
   * @param scope Scope previously resolved by this plugin.
   * @param options Planning options including the plugin's config slice.
   * @returns Gates in deterministic order; unrunnable gates carry a skip reason.
   */
  planGates(detection: StackDetection, scope: StackScope, options: GatePlanOptions): Gate[];
};
