// @file: Unit tests for the gate runner — RUN-ALL, stdout contract, env-fail rules, report format.
// @consumers: CI
// @tasks: TSK-95

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Gate, StackDiagnostic, StackRun } from '../stack.types.ts';

const { runVerify, formatVerifyReport } = await import('../gate-runner.ts');

/** @purpose Build a gate that runs a shell snippet through `sh -c`. */
function shellGate(id: string, script: string, extra: Partial<Gate> = {}): Gate {
  return {
    id,
    stack: 'golang',
    label: id,
    argv: ['/bin/sh', '-c', script],
    cwd: process.cwd(),
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
      root: process.cwd(),
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
      [],
      30_000
    );

    assert.equal(report.total, 3);
    assert.equal(report.passed, 2);
    assert.equal(report.ok, false);
  });

  it('treats stdout as failure when outputMeansFailure is set, despite exit 0', () => {
    const report = runVerify(
      [runOf([shellGate('fmt', 'echo bad.go; exit 0', { outputMeansFailure: true })])],
      [],
      30_000
    );

    assert.equal(report.results[0]?.status, 'fail');
    assert.match(report.results[0]?.output ?? '', /bad\.go/);
  });

  it('passes an outputMeansFailure gate that prints nothing', () => {
    const report = runVerify(
      [runOf([shellGate('fmt', 'exit 0', { outputMeansFailure: true })])],
      [],
      30_000
    );

    assert.equal(report.results[0]?.status, 'pass');
    assert.equal(report.ok, true);
  });

  it('classifies output matching an envFail pattern as env-fail, not a code finding', () => {
    const report = runVerify(
      [
        runOf([
          shellGate('lint', 'echo "panic: package requires newer Go version"; exit 2', {
            envFail: { patterns: ['^panic: '] },
          }),
        ]),
      ],
      [],
      30_000
    );

    assert.equal(report.results[0]?.status, 'env-fail');
  });

  it('classifies exit codes above envFail.exitAbove as env-fail', () => {
    const report = runVerify(
      [runOf([shellGate('lint', 'exit 3', { envFail: { exitAbove: 1 } })])],
      [],
      30_000
    );

    assert.equal(report.results[0]?.status, 'env-fail');
  });

  it('keeps exit codes at or below envFail.exitAbove as genuine findings', () => {
    const report = runVerify(
      [runOf([shellGate('lint', 'echo "a.go:1: issue"; exit 1', { envFail: { exitAbove: 1 } })])],
      [],
      30_000
    );

    assert.equal(report.results[0]?.status, 'fail');
  });

  it('treats a failure without envFail rules as a code finding', () => {
    const report = runVerify([runOf([shellGate('test', 'exit 1')])], [], 30_000);

    assert.equal(report.results[0]?.status, 'fail');
  });

  it('classifies an unspawnable binary as env-fail', () => {
    const gate = shellGate('build', '');
    const broken: Gate = { ...gate, argv: ['/definitely/not/a/binary'] };
    const report = runVerify([runOf([broken])], [], 30_000);

    assert.equal(report.results[0]?.status, 'env-fail');
  });

  it('reports skipped gates without executing them and excludes them from totals', () => {
    const skipped: Gate = { ...shellGate('lint', 'exit 1'), argv: [], skipped: 'tool not found' };
    const report = runVerify([runOf([skipped])], [], 30_000);

    assert.equal(report.results[0]?.status, 'skipped');
    assert.equal(report.total, 0);
    assert.equal(report.ok, true);
  });
});

describe('formatVerifyReport', () => {
  it('prints a single summary line and nothing else when all gates pass', () => {
    const report = runVerify([runOf([shellGate('vet', 'echo noise; exit 0')])], [], 30_000);
    const text = formatVerifyReport(report);

    assert.match(text, /ALL_GATES_PASS \(1\/1\)/);
    assert.ok(!text.includes('noise'), 'passing gates must contribute no output');
  });

  it('includes stack-qualified name, command, cwd and output for a failing gate', () => {
    const report = runVerify([runOf([shellGate('vet', 'echo boom >&2; exit 3')])], [], 30_000);
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
          shellGate('lint', 'echo "panic: boom"; exit 2', { envFail: { patterns: ['^panic: '] } }),
        ]),
      ],
      [],
      30_000
    );
    const text = formatVerifyReport(report);

    assert.match(text, /ENV_FAIL/);
    assert.match(text, /NOT a finding about the code/);
  });

  it('renders diagnostics with their fixes', () => {
    const diagnostic: StackDiagnostic = { code: 'X_CODE', message: 'broken', fix: 'do this' };
    const report = runVerify([runOf([shellGate('vet', 'exit 0')])], [diagnostic], 30_000);
    const text = formatVerifyReport(report);

    assert.match(text, /X_CODE: broken/);
    assert.match(text, /fix: do this/);
  });

  it('truncates very long failure output with an explicit marker', () => {
    const report = runVerify([runOf([shellGate('vet', 'seq 1 500; exit 1')])], [], 30_000);
    const text = formatVerifyReport(report);

    assert.match(text, /more lines truncated/);
  });
});
