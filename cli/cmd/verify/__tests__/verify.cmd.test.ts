// @file: Unit tests for the verify command — exit codes, --plan, --json, only/skip validation.
// @consumers: CI
// @tasks: TSK-96

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { run } = await import('../verify.cmd.ts');

/** @purpose Build argv the way node delivers it: [node, script, command, ...rest]. */
function argv(...rest: string[]): string[] {
  return ['node', 'gennady.ts', 'verify', ...rest];
}

/** @purpose Create a temp fixture dir with given files, run fn, clean up. */
async function withFixture<T>(
  files: Record<string, string>,
  fn: (dir: string) => Promise<T>
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cmd-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const target = path.join(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** @purpose Capture console.log output produced by a callback. */
async function captureLog<T>(fn: () => Promise<T>): Promise<{ value: T; log: string }> {
  const chunks: string[] = [];
  const logMock = mock.method(console, 'log', (...parts: unknown[]) => {
    chunks.push(parts.join(' '));
  });
  const errMock = mock.method(console, 'error', () => {});
  const infoMock = mock.method(console, 'info', (...parts: unknown[]) => {
    chunks.push(parts.join(' '));
  });
  try {
    const value = await fn();
    return { value, log: chunks.join('\n') };
  } finally {
    logMock.mock.restore();
    errMock.mock.restore();
    infoMock.mock.restore();
  }
}

describe('verify command', () => {
  it('exits 5 when no stack plugin recognizes the repository', async () => {
    await withFixture({ 'README.md': 'nothing here' }, async (dir) => {
      const { value } = await captureLog(() => run(argv(`--root=${dir}`)));
      assert.equal(value, 5);
    });
  });

  it('exits 4 on an unknown --stack id', async () => {
    await withFixture({ 'package.json': '{"name":"x","scripts":{"test":"true"}}' }, async (dir) => {
      const { value } = await captureLog(() => run(argv(`--root=${dir}`, '--stack=rust')));
      assert.equal(value, 4);
    });
  });

  it('exits 4 when --only names a gate absent from the plan', async () => {
    await withFixture({ 'package.json': '{"name":"x","scripts":{"test":"true"}}' }, async (dir) => {
      const { value } = await captureLog(() => run(argv(`--root=${dir}`, '--only=vet')));
      assert.equal(value, 4);
    });
  });

  it('--plan --json emits the runs without executing any gate', async () => {
    await withFixture(
      { 'package.json': '{"name":"x","scripts":{"test":"node -e \\"process.exit(1)\\""}}' },
      async (dir) => {
        const { value, log } = await captureLog(() =>
          run(argv(`--root=${dir}`, '--plan', '--json'))
        );

        // A failing test script must not affect --plan: nothing was executed.
        assert.equal(value, 0);
        const parsed = JSON.parse(log) as { runs: Array<{ detection: { stack: string } }> };
        assert.equal(parsed.runs[0]?.detection.stack, 'node');
      }
    );
  });

  it('exits 0 and prints the summary line when all gates pass', async () => {
    await withFixture(
      { 'package.json': '{"name":"x","scripts":{"test":"node -e 0"}}' },
      async (dir) => {
        const { value, log } = await captureLog(() => run(argv(`--root=${dir}`)));

        assert.equal(value, 0);
        assert.match(log, /ALL_GATES_PASS \(1\/1\)/);
      }
    );
  });

  it('exits 1 and reports the gate when a script fails', async () => {
    await withFixture(
      { 'package.json': '{"name":"x","scripts":{"test":"node -e \\"process.exit(1)\\""}}' },
      async (dir) => {
        const { value, log } = await captureLog(() => run(argv(`--root=${dir}`)));

        assert.equal(value, 1);
        assert.match(log, /FAIL gate: node:test/);
      }
    );
  });

  it('honours .gennadyrc: skip removes a gate, extraGates append one', async () => {
    await withFixture(
      {
        'package.json': '{"name":"x","scripts":{"test":"node -e \\"process.exit(1)\\""}}',
        '.gennadyrc':
          '{"stack":{"node":{"skip":["test"],"extraGates":[{"id":"ok-check","argv":["node","-e","0"]}]}}}',
      },
      async (dir) => {
        const { value, log } = await captureLog(() => run(argv(`--root=${dir}`)));

        // The failing test gate is skipped by config; the extra gate passes.
        assert.equal(value, 0);
        assert.match(log, /ALL_GATES_PASS \(1\/1\)/);
      }
    );
  });
});
