// @file: Unit tests for parseSettingsGradle — include extraction and module cap.
// @consumers: CI
// @tasks: TSK-97

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { parseSettingsGradle, DEFAULT_INCLUDE_LIMIT } = await import('../android-settings.logic.ts');

let root: string;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-settings-'));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** @purpose Write a file in the fixture root. */
function write(name: string, content: string): string {
  const target = path.join(root, name);
  fs.writeFileSync(target, content);
  return target;
}

describe('parseSettingsGradle', () => {
  it('returns first 32 module names for 33 include statements (module cap)', () => {
    // Build a settings.gradle with 33 include(":modN") statements.
    const lines = Array.from({ length: 33 }, (_, i) => `include(":mod${i + 1}")`);
    const settingsPath = write('settings-33.gradle.kts', lines.join('\n'));

    const modules = parseSettingsGradle(settingsPath, DEFAULT_INCLUDE_LIMIT);

    assert.equal(
      modules.length,
      DEFAULT_INCLUDE_LIMIT,
      `expected ${DEFAULT_INCLUDE_LIMIT}, got ${modules.length}`
    );
    assert.equal(modules[0], 'mod1');
    assert.equal(modules[DEFAULT_INCLUDE_LIMIT - 1], `mod${DEFAULT_INCLUDE_LIMIT}`);
    assert.ok(!modules.includes('mod33'), 'mod33 must be beyond the cap');
  });

  it('returns all modules when count is below the cap', () => {
    const settingsPath = write(
      'settings-3.gradle.kts',
      'include(":app")\ninclude(":core")\ninclude(":feature")\n'
    );

    const modules = parseSettingsGradle(settingsPath);

    assert.deepEqual(modules, ['app', 'core', 'feature']);
  });

  it('parses Groovy single-quote form: include ":app", ":core"', () => {
    const settingsPath = write('settings-groovy.gradle', "include ':app', ':core'\n");

    const modules = parseSettingsGradle(settingsPath);

    assert.deepEqual(modules, ['app', 'core']);
  });

  it('parses Kotlin multi-argument form: include(":a", ":b")', () => {
    const settingsPath = write('settings-multi.gradle.kts', 'include(":a", ":b", ":c")\n');

    const modules = parseSettingsGradle(settingsPath);

    assert.deepEqual(modules, ['a', 'b', 'c']);
  });

  it('returns empty list for missing file', () => {
    const modules = parseSettingsGradle(path.join(root, 'does-not-exist.gradle.kts'));

    assert.deepEqual(modules, []);
  });

  it('respects a custom limit smaller than DEFAULT_INCLUDE_LIMIT', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `include(":mod${i + 1}")`);
    const settingsPath = write('settings-custom.gradle.kts', lines.join('\n'));

    const modules = parseSettingsGradle(settingsPath, 5);

    assert.equal(modules.length, 5);
  });
});
