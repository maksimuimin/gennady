// @file: Unit tests for stack config — loading from .gennadyrc and applying overrides to a plan.
// @consumers: CI
// @tasks: TSK-95

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Gate, StackPluginConfig } from '../stack.types.ts';

const { loadStackConfig, applyStackConfig, pluginConfigOf } = await import('../stack-config.ts');
const { detectStacks } = await import('../stack-registry.ts');

/** @purpose Build a minimal executable gate fixture. */
function gate(id: string, extra: Partial<Gate> = {}): Gate {
  return {
    id,
    stack: 'golang',
    label: id,
    argv: ['tool', id],
    cwd: '/repo',
    outputMeansFailure: false,
    skipped: null,
    ...extra,
  };
}

/** @purpose Create a temp dir with an optional .gennadyrc, run fn, clean up. */
function withTempRc<T>(rcContent: string | null, fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-config-'));
  try {
    if (rcContent !== null) {
      fs.writeFileSync(path.join(dir, '.gennadyrc'), rcContent);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('loadStackConfig', () => {
  it('returns null config without diagnostics when .gennadyrc is absent', () => {
    withTempRc(null, (dir) => {
      const load = loadStackConfig(dir);
      assert.equal(load.config, null);
      assert.deepEqual(load.diagnostics, []);
    });
  });

  it('reads the stack section from a repo .gennadyrc', () => {
    withTempRc('{"stack":{"use":["golang"],"golang":{"skip":["lint"]}}}', (dir) => {
      const load = loadStackConfig(dir);
      assert.deepEqual(load.config?.use, ['golang']);
      assert.deepEqual(pluginConfigOf(load.config, 'golang')?.skip, ['lint']);
    });
  });

  it('accepts an rc with only a stack section — models are not required', () => {
    withTempRc('{"stack":{"use":["node"]}}', (dir) => {
      const load = loadStackConfig(dir);
      assert.deepEqual(load.config?.use, ['node']);
      assert.deepEqual(load.diagnostics, []);
    });
  });

  it('reads the committable gennady.config.json when .gennadyrc is absent', () => {
    withTempRc(null, (dir) => {
      fs.writeFileSync(path.join(dir, 'gennady.config.json'), '{"stack":{"use":["golang"]}}');
      const load = loadStackConfig(dir);
      assert.deepEqual(load.config?.use, ['golang']);
    });
  });

  it('prefers the personal .gennadyrc over the committed gennady.config.json', () => {
    withTempRc('{"stack":{"use":["node"]}}', (dir) => {
      fs.writeFileSync(path.join(dir, 'gennady.config.json'), '{"stack":{"use":["golang"]}}');
      const load = loadStackConfig(dir);
      assert.deepEqual(load.config?.use, ['node']);
    });
  });

  it('degrades a broken .gennadyrc to a diagnostic instead of crashing', () => {
    withTempRc('{not json', (dir) => {
      const load = loadStackConfig(dir);
      assert.equal(load.config, null);
      assert.equal(load.diagnostics[0]?.code, 'STACK_CONFIG_INVALID');
    });
  });

  it('diagnoses a non-object stack section', () => {
    withTempRc('{"stack": ["golang"]}', (dir) => {
      const load = loadStackConfig(dir);
      assert.equal(load.config, null);
      assert.equal(load.diagnostics[0]?.code, 'STACK_CONFIG_INVALID');
    });
  });
});

describe('applyStackConfig', () => {
  it('passes gates through untouched without a config', () => {
    const gates = [gate('build'), gate('test')];
    assert.deepEqual(applyStackConfig(gates, null, 'golang', '/repo'), gates);
  });

  it('applies overrides, then skip, then extraGates — in that order', () => {
    const config: StackPluginConfig = {
      skip: ['vet'],
      gates: { test: { argv: ['make', 'test'] } },
      extraGates: [{ id: 'drift', argv: ['make', 'check'], outputMeansFailure: true }],
    };

    const effective = applyStackConfig(
      [gate('build'), gate('vet'), gate('test')],
      config,
      'golang',
      '/repo'
    );

    assert.deepEqual(
      effective.map((g) => g.id),
      ['build', 'test', 'drift']
    );
    assert.deepEqual(effective[1]?.argv, ['make', 'test']);
    assert.equal(effective[2]?.outputMeansFailure, true);
  });

  it('inherits the original contract when an override does not restate it', () => {
    const original = gate('fmt', { outputMeansFailure: true });
    const effective = applyStackConfig(
      [original],
      { gates: { fmt: { argv: ['myfmt', '-l'] } } },
      'golang',
      '/repo'
    );

    assert.equal(effective[0]?.outputMeansFailure, true);
  });

  it('an argv override supersedes a planner skip', () => {
    const skipped = gate('lint', { argv: [], skipped: 'tool not found' });
    const effective = applyStackConfig(
      [skipped],
      { gates: { lint: { argv: ['mylint'] } } },
      'golang',
      '/repo'
    );

    assert.equal(effective[0]?.skipped, null);
    assert.deepEqual(effective[0]?.argv, ['mylint']);
  });

  it('resolves extraGate cwd against the repo root and defaults the contract to exit-code', () => {
    const effective = applyStackConfig(
      [],
      { extraGates: [{ id: 'x', argv: ['t'], cwd: 'sub' }] },
      'golang',
      '/repo'
    );

    assert.equal(effective[0]?.cwd, path.resolve('/repo', 'sub'));
    assert.equal(effective[0]?.outputMeansFailure, false);
  });

  it('ignores malformed extraGates entries instead of crashing', () => {
    const malformed = {
      extraGates: [{ id: 'x', argv: [] }, { argv: ['t'] }],
    } as unknown as StackPluginConfig;
    assert.deepEqual(applyStackConfig([], malformed, 'golang', '/repo'), []);
  });
});

describe('detectStacks with use restriction', () => {
  it('diagnoses unknown plugin ids in use instead of silently ignoring them', () => {
    withTempRc(null, (dir) => {
      const run = detectStacks(dir, { use: ['rust'] });
      assert.equal(run.diagnostics[0]?.code, 'STACK_USE_UNKNOWN');
      assert.deepEqual(run.active, []);
    });
  });

  it('restricts candidates but lets detection decide', () => {
    withTempRc(null, (dir) => {
      // `use: ["node"]` but no package.json — node still does not detect.
      const run = detectStacks(dir, { use: ['node'] });
      assert.deepEqual(run.active, []);
      assert.deepEqual(run.diagnostics, []);
    });
  });
});
