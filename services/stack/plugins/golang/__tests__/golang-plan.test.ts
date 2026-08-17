// @file: Unit tests for the golang gate planner — non-mutating gates, module flags, env-fail rules.
// @consumers: CI
// @tasks: TSK-95

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { GatePlanOptions } from '../../../stack.types.ts';
import type { GoProject, GoTool, GoToolId } from '../golang-detect.logic.ts';
import type { GoScope } from '../golang-scope.logic.ts';

const { planGoGates } = await import('../golang-plan.logic.ts');

/** @purpose Build a resolved tool stub pointing at a fake absolute path. */
function tool(id: GoToolId, available = true): GoTool {
  return {
    id,
    bin: available ? `/usr/bin/${id}` : null,
    origin: available ? 'path' : 'missing',
    builtWithGo: null,
  };
}

/** @purpose Build a project fixture, overriding only the fields a test cares about. */
function project(overrides: Partial<GoProject> = {}): GoProject {
  return {
    root: '/repo',
    modules: [{ dir: '/repo', path: 'example.com/app', goVersion: '1.24' }],
    workspace: null,
    vendored: false,
    golangciConfig: null,
    missingGolangciConfigs: [],
    makeTargets: [],
    tools: { go: tool('go'), 'golangci-lint': tool('golangci-lint'), gofmt: tool('gofmt') },
    diagnostics: [],
    ...overrides,
  };
}

/** @purpose Build a scope fixture covering a single package. */
function scope(overrides: Partial<GoScope> = {}): GoScope {
  return {
    mode: 'files',
    packages: ['./internal/foo'],
    files: ['/repo/internal/foo/foo.go'],
    fmtTargets: ['internal/foo/foo.go'],
    note: 'test fixture',
    ...overrides,
  };
}

const defaultOptions: GatePlanOptions = { tidy: false, pluginConfig: null };

describe('planGoGates', () => {
  it('never plans the mutating `go fmt`; uses `gofmt -l` with the stdout contract', () => {
    const gates = planGoGates(project(), scope(), defaultOptions);
    const fmt = gates.find((gate) => gate.id === 'fmt');

    assert.deepEqual(fmt?.argv.slice(1, 2), ['-l']);
    assert.equal(fmt?.outputMeansFailure, true);
    for (const gate of gates) {
      assert.ok(
        !gate.argv.join(' ').includes('go fmt'),
        'no gate may invoke the rewriting `go fmt`'
      );
      assert.ok(!/\bmod tidy\b(?!.*-diff)/.test(gate.argv.join(' ')), 'tidy must run with -diff');
    }
  });

  it('emits gates in diagnostic order — build before vet before test', () => {
    const ids = planGoGates(project(), scope(), defaultOptions).map((gate) => gate.id);

    assert.ok(ids.indexOf('build') < ids.indexOf('vet'));
    assert.ok(ids.indexOf('vet') < ids.indexOf('test'));
  });

  it('adds -mod=vendor for a vendored module', () => {
    const gates = planGoGates(project({ vendored: true }), scope(), defaultOptions);

    assert.ok(gates.find((gate) => gate.id === 'build')?.argv.includes('-mod=vendor'));
    assert.ok(gates.find((gate) => gate.id === 'test')?.argv.includes('-mod=vendor'));
  });

  it('omits -mod=vendor under a go workspace, which rejects the combination', () => {
    const gates = planGoGates(
      project({ vendored: true, workspace: '/repo/go.work' }),
      scope(),
      defaultOptions
    );

    assert.ok(!gates.find((gate) => gate.id === 'build')?.argv.includes('-mod=vendor'));
  });

  it('passes the discovered lint config explicitly via -c', () => {
    const gates = planGoGates(
      project({ golangciConfig: '/repo/golangci.yml' }),
      scope(),
      defaultOptions
    );
    const lint = gates.find((gate) => gate.id === 'lint');

    assert.ok(lint?.argv.includes('-c'));
    assert.ok(lint?.argv.includes('/repo/golangci.yml'));
  });

  it('lets plugin config override the lint config path and the test timeout', () => {
    const gates = planGoGates(project({ golangciConfig: '/repo/.golangci.yml' }), scope(), {
      tidy: false,
      pluginConfig: { lintConfig: '/repo/ci/golangci.yml', testTimeout: '90s' },
    });

    assert.ok(gates.find((gate) => gate.id === 'lint')?.argv.includes('/repo/ci/golangci.yml'));
    assert.ok(gates.find((gate) => gate.id === 'test')?.argv.includes('-timeout=90s'));
  });

  it('declares env-fail rules: lint exit above 1, panic and module-fetch patterns everywhere', () => {
    const gates = planGoGates(project(), scope(), defaultOptions);
    const lint = gates.find((gate) => gate.id === 'lint');
    const build = gates.find((gate) => gate.id === 'build');

    assert.equal(lint?.envFail?.exitAbove, 1);
    assert.ok(lint?.envFail?.patterns?.some((pattern) => pattern.includes('panic')));
    assert.ok(build?.envFail?.patterns?.some((pattern) => pattern.includes('proxy')));
  });

  it('skips lint with a stated reason when golangci-lint is unavailable', () => {
    const gates = planGoGates(
      project({
        tools: {
          go: tool('go'),
          'golangci-lint': tool('golangci-lint', false),
          gofmt: tool('gofmt'),
        },
      }),
      scope(),
      defaultOptions
    );
    const lint = gates.find((gate) => gate.id === 'lint');

    assert.notEqual(lint?.skipped, null);
    assert.deepEqual(lint?.argv, []);
  });

  it('skips package gates, but still formats, when the scope has no packages', () => {
    const gates = planGoGates(
      project(),
      scope({ packages: [], files: [], fmtTargets: ['internal/foo/foo.go'] }),
      defaultOptions
    );

    assert.notEqual(gates.find((gate) => gate.id === 'build')?.skipped, null);
    assert.equal(gates.find((gate) => gate.id === 'fmt')?.skipped, null);
  });

  it('excludes tidy unless requested via option or plugin config', () => {
    const without = planGoGates(project(), scope(), defaultOptions);
    const viaOption = planGoGates(project(), scope(), { tidy: true, pluginConfig: null });
    const viaConfig = planGoGates(project(), scope(), {
      tidy: false,
      pluginConfig: { tidy: true },
    });

    assert.equal(
      without.some((gate) => gate.id === 'tidy'),
      false
    );
    assert.ok(viaOption.find((gate) => gate.id === 'tidy')?.argv.includes('-diff'));
    assert.ok(viaConfig.find((gate) => gate.id === 'tidy')?.argv.includes('-diff'));
  });

  it('skips every go-dependent gate when the toolchain is missing', () => {
    const gates = planGoGates(
      project({
        tools: {
          go: tool('go', false),
          'golangci-lint': tool('golangci-lint'),
          gofmt: tool('gofmt'),
        },
      }),
      scope(),
      defaultOptions
    );

    for (const gate of gates) {
      if (gate.id !== 'fmt') {
        assert.notEqual(gate.skipped, null, `${gate.id} must be skipped without a go toolchain`);
      }
    }
  });
});
