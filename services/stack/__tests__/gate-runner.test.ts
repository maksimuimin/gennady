// @file: Unit tests for the gate runner — RUN-ALL, stdout contract, env-fail predicates, report format.
// @consumers: CI
// @tasks: TSK-95, TSK-97

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Gate, StackDiagnostic, StackPlugin, StackRun } from '../stack.types.ts';

const { runVerify, formatVerifyReport, exitAbove, outputMatches } =
  await import('../gate-runner.ts');

// Small one-commit repo shared by the plain-gate tests: every gate runs in a run
// replica (D-STACK-013), so cwd must never be the (large) gennady checkout itself.
const BASE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-base-'));
fs.writeFileSync(path.join(BASE_DIR, 'README.md'), 'fixture\n');
execFileSync('git', ['-C', BASE_DIR, 'init', '-q', '-b', 'main'], { stdio: 'ignore' });
execFileSync('git', ['-C', BASE_DIR, 'add', '-A'], { stdio: 'ignore' });
execFileSync(
  'git',
  ['-C', BASE_DIR, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'],
  { stdio: 'ignore' }
);
after(() => fs.rmSync(BASE_DIR, { recursive: true, force: true }));

/** @purpose Build a gate that runs a shell snippet through `sh -c`. */
function shellGate(id: string, script: string, extra: Partial<Gate> = {}): Gate {
  return {
    id,
    stack: 'golang',
    label: id,
    argv: ['/bin/sh', '-c', script],
    cwd: BASE_DIR,
    timeoutMs: 30_000,
    outputMeansFailure: false,
    skipped: null,
    ...extra,
  };
}

/** @purpose Wrap gates into a single-stack run fixture. */
function runOf(gates: Gate[]): StackRun {
  return {
    detection: {
      stack: 'golang',
      root: BASE_DIR,
      summary: ['module: example.com/x'],
      diagnostics: [],
      details: null,
    },
    scope: { mode: 'changed', note: 'test fixture', details: null },
    gates,
  };
}

describe('runVerify', () => {
  it('runs every gate even after one fails (RUN-ALL)', () => {
    const report = runVerify(
      [
        runOf([
          shellGate('build', 'exit 1'),
          shellGate('vet', 'exit 0'),
          shellGate('test', 'exit 0'),
        ]),
      ],
      []
    );

    assert.equal(report.total, 3);
    assert.equal(report.passed, 2);
    assert.equal(report.ok, false);
  });

  it('treats stdout as failure when outputMeansFailure is set, despite exit 0', () => {
    const report = runVerify(
      [runOf([shellGate('fmt', 'echo bad.go; exit 0', { outputMeansFailure: true })])],
      []
    );

    assert.equal(report.results[0]?.status, 'fail');
    assert.match(report.results[0]?.output ?? '', /bad\.go/);
  });

  it('passes an outputMeansFailure gate that prints nothing', () => {
    const report = runVerify(
      [runOf([shellGate('fmt', 'exit 0', { outputMeansFailure: true })])],
      []
    );

    assert.equal(report.results[0]?.status, 'pass');
    assert.equal(report.ok, true);
  });

  it('classifies a failure as env-fail when an outputMatches predicate fires', () => {
    const report = runVerify(
      [
        runOf([
          shellGate('lint', 'echo "panic: package requires newer Go version"; exit 2', {
            envFail: [outputMatches(/^panic: /m)],
          }),
        ]),
      ],
      []
    );

    assert.equal(report.results[0]?.status, 'env-fail');
  });

  it('appends the matched predicate hint to env-fail output (D-STACK-012)', () => {
    const report = runVerify(
      [
        runOf([
          shellGate('generate', 'echo "exec: \\"easyjson\\": executable file not found"; exit 1', {
            envFail: [outputMatches(/executable file not found/, 'install it with `go install`')],
          }),
        ]),
      ],
      []
    );

    assert.equal(report.results[0]?.status, 'env-fail');
    assert.match(report.results[0]?.output ?? '', /hint: install it with `go install`/);
  });

  it('classifies exit codes above the exitAbove threshold as env-fail', () => {
    const report = runVerify(
      [runOf([shellGate('lint', 'exit 3', { envFail: [exitAbove(1)] })])],
      []
    );

    assert.equal(report.results[0]?.status, 'env-fail');
  });

  it('keeps exit codes at or below the exitAbove threshold as genuine findings', () => {
    const report = runVerify(
      [runOf([shellGate('lint', 'echo "a.go:1: issue"; exit 1', { envFail: [exitAbove(1)] })])],
      []
    );

    assert.equal(report.results[0]?.status, 'fail');
  });

  it('treats a failure without predicates as a code finding', () => {
    const report = runVerify([runOf([shellGate('test', 'exit 1')])], []);

    assert.equal(report.results[0]?.status, 'fail');
  });

  it('classifies an unspawnable binary as env-fail', () => {
    const broken: Gate = { ...shellGate('build', ''), argv: ['/definitely/not/a/binary'] };
    const report = runVerify([runOf([broken])], []);

    assert.equal(report.results[0]?.status, 'env-fail');
  });

  it('kills a gate exceeding its own timeoutMs and reports TIMEOUT', () => {
    const report = runVerify([runOf([shellGate('test', 'sleep 5', { timeoutMs: 300 })])], []);

    assert.equal(report.results[0]?.status, 'timeout');
  });

  it('merges gate.env over the process environment', () => {
    const report = runVerify(
      [
        runOf([
          shellGate('build', '[ "$STACK_TEST_VAR" = "42" ] || { echo "missing env"; exit 1; }', {
            env: { STACK_TEST_VAR: '42' },
          }),
        ]),
      ],
      []
    );

    assert.equal(report.results[0]?.status, 'pass');
  });

  it('reports skipped gates without executing them and excludes them from totals', () => {
    const skipped: Gate = { ...shellGate('lint', 'exit 1'), argv: [], skipped: 'tool not found' };
    const report = runVerify([runOf([skipped])], []);

    assert.equal(report.results[0]?.status, 'skipped');
    assert.equal(report.total, 0);
    assert.equal(report.ok, true);
  });
});

describe('formatVerifyReport', () => {
  it('reports ZERO_GATES, not ALL_GATES_PASS, when nothing was executed (review B2)', () => {
    const skipped: Gate = { ...shellGate('lint', 'exit 1'), argv: [], skipped: 'tool not found' };
    const report = runVerify([runOf([skipped])], []);
    const text = formatVerifyReport(report);

    assert.match(text, /ZERO_GATES/);
    assert.ok(!text.includes('ALL_GATES_PASS'), 'verified-nothing must not read as success');
  });

  it('keeps the tail of long failure output, where test runners put the summary (review N1)', () => {
    const report = runVerify([runOf([shellGate('vet', 'seq 1 500; exit 1')])], []);
    const text = formatVerifyReport(report);

    assert.match(text, /lines truncated/);
    assert.ok(
      text.includes('\n499\n'),
      'the tail (failure summary territory) must survive truncation'
    );
  });

  it('prints a single summary line and nothing else when all gates pass', () => {
    const report = runVerify([runOf([shellGate('vet', 'echo noise; exit 0')])], []);
    const text = formatVerifyReport(report);

    assert.match(text, /ALL_GATES_PASS \(1\/1\)/);
    assert.ok(!text.includes('noise'), 'passing gates must contribute no output');
  });

  it('includes stack-qualified name, command, cwd and output for a failing gate', () => {
    const report = runVerify([runOf([shellGate('vet', 'echo boom >&2; exit 3')])], []);
    const text = formatVerifyReport(report);

    assert.match(text, /FAIL gate: golang:vet/);
    assert.match(text, /command:/);
    assert.match(text, /cwd:/);
    assert.match(text, /boom/);
  });

  it('warns an agent not to edit sources on env-fail', () => {
    const report = runVerify(
      [
        runOf([
          shellGate('lint', 'echo "panic: boom"; exit 2', {
            envFail: [outputMatches(/^panic: /m)],
          }),
        ]),
      ],
      []
    );
    const text = formatVerifyReport(report);

    assert.match(text, /ENV_FAIL/);
    assert.match(text, /NOT a finding about the code/);
  });

  it('renders diagnostics with their fixes', () => {
    const diagnostic: StackDiagnostic = { code: 'X_CODE', message: 'broken', fix: 'do this' };
    const report = runVerify([runOf([shellGate('vet', 'exit 0')])], [diagnostic]);
    const text = formatVerifyReport(report);

    assert.match(text, /X_CODE: broken/);
    assert.match(text, /fix: do this/);
  });

  it('truncates very long failure output with an explicit marker', () => {
    const report = runVerify([runOf([shellGate('vet', 'seq 1 500; exit 1')])], []);
    const text = formatVerifyReport(report);

    assert.match(text, /lines truncated/);
  });
});

/** @purpose Run git quietly in a fixture dir. */
function fixtureGit(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    stdio: 'ignore',
  });
}

/** @purpose Create a committed git fixture with one tracked file, run fn, clean up. */
function withGitFixture<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-gate-'));
  try {
    fs.writeFileSync(path.join(dir, 'gen.txt'), 'original\n');
    fixtureGit(dir, 'init', '-q', '-b', 'main');
    fixtureGit(dir, 'add', '-A');
    fixtureGit(dir, 'commit', '-qm', 'init');
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('runVerify — sandboxed gates (spec §2, D-STACK-011)', () => {
  it('classifies generator drift as FAIL with the file list, leaving the real tree untouched', () => {
    withGitFixture((dir) => {
      const gate: Gate = {
        ...shellGate('generate', 'echo regenerated > gen.txt'),
        cwd: dir,
        sandbox: true,
      };
      const report = runVerify([runOf([gate])], []);

      assert.equal(report.results[0]?.status, 'fail');
      assert.match(report.results[0]?.output ?? '', /gen\.txt/);
      // The real tree is byte-identical: the mutation happened in the replica only.
      assert.equal(fs.readFileSync(path.join(dir, 'gen.txt'), 'utf-8'), 'original\n');
    });
  });

  it('passes a drift-free sandboxed gate', () => {
    withGitFixture((dir) => {
      const gate: Gate = { ...shellGate('generate', 'true'), cwd: dir, sandbox: true };
      const report = runVerify([runOf([gate])], []);

      assert.equal(report.results[0]?.status, 'pass');
    });
  });

  it('replicates uncommitted and untracked changes into the sandbox', () => {
    withGitFixture((dir) => {
      fs.writeFileSync(path.join(dir, 'gen.txt'), 'agent-edit\n'); // uncommitted tracked edit
      fs.writeFileSync(path.join(dir, 'new.txt'), 'untracked\n'); // untracked file
      const gate: Gate = {
        ...shellGate('generate', 'grep -q agent-edit gen.txt && grep -q untracked new.txt'),
        cwd: dir,
        sandbox: true,
      };
      const report = runVerify([runOf([gate])], []);

      assert.equal(report.results[0]?.status, 'pass', report.results[0]?.output);
    });
  });

  it('catches drift over a file the agent had already edited (content-level baseline)', () => {
    withGitFixture((dir) => {
      fs.writeFileSync(path.join(dir, 'gen.txt'), 'agent-edit\n');
      const gate: Gate = {
        ...shellGate('generate', 'echo generator-output > gen.txt'),
        cwd: dir,
        sandbox: true,
      };
      const report = runVerify([runOf([gate])], []);

      assert.equal(report.results[0]?.status, 'fail');
      // And the agent's uncommitted edit survives in the real tree.
      assert.equal(fs.readFileSync(path.join(dir, 'gen.txt'), 'utf-8'), 'agent-edit\n');
    });
  });

  it('reports env-fail when the replica cannot be created (no commits yet)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-nogit-'));
    try {
      fixtureGit(dir, 'init', '-q', '-b', 'main'); // repo without a single commit
      const gate: Gate = { ...shellGate('generate', 'true'), cwd: dir, sandbox: true };
      const report = runVerify([runOf([gate])], []);

      assert.equal(report.results[0]?.status, 'env-fail');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runVerify — run replica enforcement (spec §2, D-STACK-013)', () => {
  it('flags a non-sandbox gate that mutates the tree as VIOLATION and resets the replica', () => {
    withGitFixture((dir) => {
      const mutator: Gate = { ...shellGate('bad', 'echo dirt > dirt.txt'), cwd: dir };
      const checker: Gate = { ...shellGate('probe', 'test ! -f dirt.txt'), cwd: dir };
      const report = runVerify([runOf([mutator, checker])], []);

      assert.equal(report.results[0]?.status, 'violation');
      assert.match(report.results[0]?.output ?? '', /dirt\.txt/);
      assert.match(formatVerifyReport(report), /VIOLATION/);
      assert.match(formatVerifyReport(report), /fixer/);
      assert.equal(
        report.results[1]?.status,
        'pass',
        'the replica is reset to baseline between gates'
      );
      assert.equal(fs.existsSync(path.join(dir, 'dirt.txt')), false, 'real tree untouched');
      assert.equal(report.ok, false);
    });
  });

  it('rewrites replica paths in gate output back to real-tree paths', () => {
    withGitFixture((dir) => {
      const gate: Gate = {
        ...shellGate('build', 'echo "$PWD/gen.txt:1: broken"; exit 1'),
        cwd: dir,
      };
      const report = runVerify([runOf([gate])], []);
      const real = fs.realpathSync(dir);

      assert.equal(report.results[0]?.status, 'fail');
      assert.ok(
        (report.results[0]?.output ?? '').includes(`${real}/gen.txt:1: broken`),
        `expected real path ${real}, got: ${report.results[0]?.output}`
      );
    });
  });

  it('maps real-tree absolute paths in argv into the replica (config files, targets)', () => {
    withGitFixture((dir) => {
      // The argv references a repo file by real absolute path (like golangci -c <cfg>);
      // inside the replica it must resolve to the replica copy, or relative paths
      // computed against it walk out of the sandbox.
      const gate: Gate = {
        ...shellGate('cfg', 'test "$(cd "$(dirname "$1")" && pwd -P)" = "$(pwd -P)"'),
        cwd: dir,
      };
      const report = runVerify(
        [runOf([{ ...gate, argv: [...gate.argv, 'sh', path.join(dir, 'gen.txt')] }])],
        []
      );

      assert.equal(report.results[0]?.status, 'pass', report.results[0]?.output);
    });
  });

  it('runs gates outside a git repository unsandboxed, with a loud diagnostic', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-run-'));
    try {
      const gate: Gate = { ...shellGate('build', 'true'), cwd: dir };
      const report = runVerify([runOf([gate])], []);

      assert.equal(report.results[0]?.status, 'pass');
      assert.ok(
        report.diagnostics.some((diagnostic) => diagnostic.code === 'UNSANDBOXED_RUN'),
        'the unenforced run must be visible'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('symlinks declared sandboxLinks into the replica (environment, not tree state)', () => {
    withGitFixture((dir) => {
      fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
      fixtureGit(dir, 'add', '-A');
      fixtureGit(dir, 'commit', '-qm', 'ignore');
      fs.mkdirSync(path.join(dir, 'node_modules'));
      fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), 'x');
      const gate: Gate = { ...shellGate('lint', 'test -e node_modules/dep.js'), cwd: dir };
      const report = runVerify([runOf([gate])], [], { sandboxLinks: ['node_modules'] });

      assert.equal(report.results[0]?.status, 'pass', report.results[0]?.output);
    });
  });

  it('runVerify in a subdirectory of git-root: cwd relpath applied and output paths rewritten to real tree', () => {
    // git init in parent; gate.cwd = <parent>/android
    // Runner must: (a) execute in <replica>/android; (b) rewrite <replica>/android/… → <real>/android/…
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'android-subdir-'));
    try {
      const android = path.join(parent, 'android');
      fs.mkdirSync(android, { recursive: true });
      fs.writeFileSync(path.join(parent, 'README.md'), 'root\n');
      fs.writeFileSync(path.join(android, 'build.gradle.kts'), 'plugins {}\n');
      fixtureGit(parent, 'init', '-q', '-b', 'main');
      fixtureGit(parent, 'add', '-A');
      fixtureGit(parent, 'commit', '-qm', 'init');

      // Gate runs in android/ subdir; command fails and emits a path that includes a file
      // under the gate's cwd — runner will rewrite <replica>/android/… → <real>/android/…
      const sentinelFile = 'build.gradle.kts';
      const gate: Gate = {
        ...shellGate('build', `echo "$PWD/${sentinelFile}:10: error"; exit 1`),
        cwd: android,
      };

      const report = runVerify([runOf([gate])], []);
      const realAndroid = fs.realpathSync(android);
      const output = report.results[0]?.output ?? '';

      // (a) gate ran with cwd inside <replica>/android — verified via path-rewrite roundtrip:
      //     if runner set cwd to <replica>/android, the command printed <replica>/android/build.gradle.kts:10:
      //     which was rewritten to <real>/android/build.gradle.kts:10: — observable in output
      assert.ok(
        output.includes(`${realAndroid}/${sentinelFile}:10:`),
        `output must contain real android path; got: ${output}`
      );
      // (b) no replica path (i.e. /tmp/worktree- prefix) remains in the output
      assert.ok(
        !output.includes('/tmp/worktree-'),
        `replica path must not remain in output; got: ${output}`
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('UNSANDBOXED_RUN with sandboxLinks plugin: sandboxLinks ignored, .gradle sentinel untouched, output contains real path', () => {
    // Fixture dir WITHOUT a .git repo → triggers UNSANDBOXED_RUN path
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-unsandboxed-'));
    try {
      // Place a sentinel file in .gradle/ to verify it is never symlinked or modified
      const gradleDir = path.join(dir, '.gradle');
      const sentinel = path.join(gradleDir, 'sentinel.txt');
      fs.mkdirSync(gradleDir, { recursive: true });
      fs.writeFileSync(sentinel, 'original\n');

      // Gate: fails and prints its own cwd — so we can verify no replica path appears
      const gate: Gate = {
        ...shellGate('build', 'echo "$PWD/App.kt:5: error"; exit 1'),
        cwd: dir,
      };

      // Stub plugin with non-empty sandboxLinks (android-like) to confirm they are ignored
      const stubPlugin: StackPlugin = {
        id: 'android',
        marker: 'settings.gradle.kts',
        description: 'stub android plugin for unsandboxed test',
        sandboxLinks: ['.gradle', '.kotlin'],
        detect: () => null,
        verify: {
          resolveScope: (d, r) => ({ mode: r.mode, note: 'stub', details: null }),
          planGates: () => [],
        },
      };

      const report = runVerify([runOf([gate])], [], {
        sandboxLinks: stubPlugin.sandboxLinks,
      });

      // (a) UNSANDBOXED_RUN diagnostic must appear
      assert.ok(
        report.diagnostics.some((d) => d.code === 'UNSANDBOXED_RUN'),
        'UNSANDBOXED_RUN diagnostic must be present'
      );

      // (b) no replica directory created (no worktree dirs in /tmp from this run)
      // Verified via sentinel: .gradle/ was not symlinked (original content preserved, not a symlink)
      assert.ok(!fs.lstatSync(gradleDir).isSymbolicLink(), '.gradle must not be a symlink');
      assert.equal(
        fs.readFileSync(sentinel, 'utf-8'),
        'original\n',
        'sentinel file must be untouched'
      );

      // (c)+(d) gate ran with real cwd (no replica path rewrite); output contains real dir path
      const output = report.results[0]?.output ?? '';
      const realDir = fs.realpathSync(dir);
      assert.ok(
        output.includes(`${realDir}/App.kt:5:`),
        `output must contain real cwd path; got: ${output}`
      );

      // (f) no replica path prefix appears in output
      assert.ok(
        !output.includes('/tmp/worktree-'),
        `no replica path prefix must appear in output; got: ${output}`
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
