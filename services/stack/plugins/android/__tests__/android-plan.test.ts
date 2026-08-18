// @file: Unit tests for planAndroidGates — gate ordering, optional skips, timeouts, scope.
// @consumers: CI
// @tasks: TSK-97

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { GatePlanOptions } from '../../../stack.types.ts';
import type { AndroidProject } from '../android-detect.logic.ts';

const { planAndroidGates, ANDROID_GATE_ORDER } = await import('../android-plan.logic.ts');

const defaultOptions: GatePlanOptions = { pluginConfig: null };

/** @purpose Build a minimal AndroidProject fixture; overrides applied on top. */
function project(overrides: Partial<AndroidProject> = {}): AndroidProject {
  return {
    root: '/repo',
    agpHolderFile: '/repo/app/build.gradle.kts',
    agpHolderModule: 'app',
    agpVersion: '8.5.0',
    submodules: [':app'],
    resolvedAlias: null,
    wrapperPaths: {
      settings: '/repo/settings.gradle.kts',
      build: '/repo/build.gradle.kts',
      gradlew: '/repo/gradlew',
    },
    optionalPlugins: {
      ktlint: false,
      detekt: false,
      spotless: false,
    },
    ...overrides,
  };
}

describe('planAndroidGates', () => {
  it('plans exactly the built-in gates in order: assemble, lint, test, ktlint, detekt, spotless', () => {
    const ids = planAndroidGates(project(), defaultOptions).map((gate) => gate.id);

    assert.deepEqual(ids, [...ANDROID_GATE_ORDER]);
  });

  it('base 3 gates are executable when detect succeeded (no optional plugins)', () => {
    const gates = planAndroidGates(project(), defaultOptions);

    for (const id of ['assemble', 'lint', 'test']) {
      const gate = gates.find((g) => g.id === id);
      assert.ok(gate !== undefined, `gate ${id} must exist`);
      assert.equal(gate.skipped, null, `${id} must be executable`);
      assert.ok(gate.argv.length > 0, `${id} must have a non-empty argv`);
    }
  });

  it('optional 3 gates are skipped with reason when plugins absent', () => {
    const gates = planAndroidGates(project(), defaultOptions);

    for (const id of ['ktlint', 'detekt', 'spotless']) {
      const gate = gates.find((g) => g.id === id);
      assert.ok(gate !== undefined, `gate ${id} must exist`);
      assert.ok(gate.skipped !== null, `${id} must be skipped when plugin absent`);
      assert.match(gate.skipped, /не подключён/, `${id} skip reason must explain plugin absence`);
    }
  });

  it('optional gates executable when optional plugins present', () => {
    const gates = planAndroidGates(
      project({
        optionalPlugins: { ktlint: true, detekt: true, spotless: true },
      }),
      defaultOptions
    );

    for (const id of ['ktlint', 'detekt', 'spotless']) {
      const gate = gates.find((g) => g.id === id);
      assert.ok(gate !== undefined, `gate ${id} must exist`);
      assert.equal(gate.skipped, null, `${id} must be executable when plugin present`);
      assert.ok(gate.argv.length > 0, `${id} must have a non-empty argv`);
    }
  });

  it('all executable gates have a positive timeoutMs', () => {
    const gates = planAndroidGates(
      project({ optionalPlugins: { ktlint: true, detekt: true, spotless: true } }),
      defaultOptions
    );

    for (const gate of gates.filter((g) => g.skipped === null)) {
      assert.ok(gate.timeoutMs > 0, `${gate.id} must carry a positive timeout`);
    }
  });

  it('resolveScope for changed mode returns repo-level scope with a note (D-STACK-006)', async () => {
    const { androidPlugin } = await import('../android-plugin.ts');
    const scope = androidPlugin.verify.resolveScope(
      {
        stack: 'android',
        root: '/repo',
        summary: [],
        diagnostics: [],
        details: project(),
      },
      { mode: 'changed', targets: [] }
    );

    assert.equal(scope.mode, 'changed');
    assert.ok(scope.note.length > 0, 'note must be non-empty');
    assert.match(scope.note, /[Gg]radle/, 'note should mention Gradle repo-wide scope');
  });

  it('all gates belong to the android stack', () => {
    const gates = planAndroidGates(project(), defaultOptions);

    for (const gate of gates) {
      assert.equal(gate.stack, 'android');
    }
  });

  it('base gates invoke gradlew tasks: assembleDebug, lintDebug, testDebugUnitTest', () => {
    const gates = planAndroidGates(project(), defaultOptions);

    assert.ok(gates.find((g) => g.id === 'assemble')?.argv.includes('assembleDebug'));
    assert.ok(gates.find((g) => g.id === 'lint')?.argv.includes('lintDebug'));
    assert.ok(gates.find((g) => g.id === 'test')?.argv.includes('testDebugUnitTest'));
  });
});
