// @file: Unit tests for parseVersionCatalog — TOML alias parsing and alias-name forms.
// @consumers: CI
// @tasks: TSK-97

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { parseVersionCatalog } = await import('../android-version-catalog.logic.ts');

let root: string;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'android-vcat-'));
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** @purpose Write a file in the fixture root, return its absolute path. */
function write(name: string, content: string): string {
  const target = path.join(root, name);
  fs.writeFileSync(target, content);
  return target;
}

describe('parseVersionCatalog', () => {
  it('parses inline form: alias = { id = "...", version.ref = "..." }', () => {
    const toml = write(
      'libs-inline.toml',
      [
        '[plugins]',
        'android-application = { id = "com.android.application", version.ref = "agp" }',
        'ktlint = { id = "org.jlleitschuh.gradle.ktlint", version.ref = "ktlint" }',
      ].join('\n')
    );

    const map = parseVersionCatalog(toml);

    assert.equal(map.get('android-application'), 'com.android.application');
    assert.equal(map.get('ktlint'), 'org.jlleitschuh.gradle.ktlint');
  });

  it('parses string form: alias = "id:version"', () => {
    const toml = write(
      'libs-string.toml',
      ['[plugins]', 'android-app = "com.android.application:8.5.0"'].join('\n')
    );

    const map = parseVersionCatalog(toml);

    assert.equal(map.get('android-app'), 'com.android.application');
  });

  it('resolves non-standard alias names: agp, android-app, androidApplication', () => {
    // Spec case: libs.versions.toml with non-standard alias names — resolving by id field
    const toml = write(
      'libs-aliases.toml',
      [
        '[plugins]',
        'agp = { id = "com.android.application", version.ref = "agp" }',
        'android-app = { id = "com.android.application", version.ref = "agp" }',
        'androidApplication = { id = "com.android.application", version.ref = "agp" }',
      ].join('\n')
    );

    const map = parseVersionCatalog(toml);

    assert.equal(map.get('agp'), 'com.android.application');
    assert.equal(map.get('android-app'), 'com.android.application');
    assert.equal(map.get('androidApplication'), 'com.android.application');
  });

  it('returns empty map when [plugins] section is absent', () => {
    const toml = write(
      'libs-no-plugins.toml',
      [
        '[versions]',
        'agp = "8.5.0"',
        '[libraries]',
        'core = { module = "x:y", version = "1" }',
      ].join('\n')
    );

    const map = parseVersionCatalog(toml);

    assert.equal(map.size, 0);
  });

  it('returns empty map for a missing file', () => {
    const map = parseVersionCatalog(path.join(root, 'nonexistent.toml'));

    assert.equal(map.size, 0);
  });

  it('inline form takes precedence over string form for the same alias', () => {
    const toml = write(
      'libs-both.toml',
      [
        '[plugins]',
        'foo = { id = "com.plugin.a", version = "1.0" }',
        'foo = "com.plugin.b:1.0"',
      ].join('\n')
    );

    const map = parseVersionCatalog(toml);

    // The inline form is parsed first, so it wins; string form for same alias is skipped.
    assert.equal(map.get('foo'), 'com.plugin.a');
  });

  it('does not include entries from other sections', () => {
    const toml = write(
      'libs-other-sections.toml',
      [
        '[versions]',
        'ktlint = "12.0"',
        '[libraries]',
        'ktlint-lib = { module = "org.jlleitschuh.gradle.ktlint:lib", version = "12.0" }',
        '[plugins]',
        'detekt = { id = "io.gitlab.arturbosch.detekt", version.ref = "detekt" }',
      ].join('\n')
    );

    const map = parseVersionCatalog(toml);

    assert.equal(map.size, 1);
    assert.equal(map.get('detekt'), 'io.gitlab.arturbosch.detekt');
  });
});
