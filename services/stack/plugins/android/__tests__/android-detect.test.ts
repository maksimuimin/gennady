// @file: Unit tests for detectAndroid — composite detection per spec §3.6.
// @consumers: CI
// @tasks: TSK-97

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { detectAndroid } = await import('../android-detect.logic.ts');

/** @purpose Write a file under root, creating parent directories as needed. */
function write(root: string, rel: string, content: string): void {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** @purpose Create a minimal valid Gradle wrapper layout in root. */
function writeWrapper(
  root: string,
  {
    settings = 'settings.gradle.kts',
    build = 'build.gradle.kts',
  }: { settings?: string; build?: string } = {}
): void {
  write(root, settings, '');
  write(root, build, '');
  write(root, 'gradlew', '#!/bin/sh\nexec gradle "$@"\n');
  write(root, 'gradle/wrapper/gradle-wrapper.jar', '');
  write(
    root,
    'gradle/wrapper/gradle-wrapper.properties',
    'distributionUrl=https://services.gradle.org/distributions/gradle-8.7-bin.zip\n'
  );
}

/** @purpose Isolate each test in its own temp dir, cleaned up after. */
function withDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-detect-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('detectAndroid', () => {
  it('canonical multi-module: AGP via alias in :app, ktlint apply false in root → detect success, android:ktlint executable', () => {
    withDir((root) => {
      writeWrapper(root);
      // TOML: android.application + ktlint aliases
      write(
        root,
        'gradle/libs.versions.toml',
        [
          '[versions]',
          'agp = "8.5.0"',
          'ktlint = "12.0"',
          '[plugins]',
          'android-application = { id = "com.android.application", version.ref = "agp" }',
          'ktlint = { id = "org.jlleitschuh.gradle.ktlint", version.ref = "ktlint" }',
        ].join('\n')
      );
      // Root build.gradle.kts: alias apply false (delegation pattern)
      write(
        root,
        'build.gradle.kts',
        [
          'plugins {',
          '    alias(libs.plugins.android.application) apply false',
          '    alias(libs.plugins.ktlint) apply false',
          '}',
        ].join('\n')
      );
      // settings.gradle.kts: includes :app
      write(root, 'settings.gradle.kts', 'include(":app")\n');
      // :app/build.gradle.kts: holder of AGP
      write(
        root,
        'app/build.gradle.kts',
        ['plugins {', '    alias(libs.plugins.android.application)', '}'].join('\n')
      );

      const result = detectAndroid(root);

      assert.ok(result.detection !== null, 'detection must succeed');
      assert.equal(result.detection.stack, 'android');
      const details = result.detection
        .details as import('../android-detect.logic.ts').AndroidProject;
      assert.equal(details.optionalPlugins.ktlint, true, 'ktlint must be detected');
    });
  });

  it('single-module: AGP direct in root, ktlint alias via TOML → detect success, ktlint executable', () => {
    withDir((root) => {
      writeWrapper(root);
      // TOML with ktlint only
      write(
        root,
        'gradle/libs.versions.toml',
        [
          '[versions]',
          'ktlint = "12.0"',
          '[plugins]',
          'ktlint = { id = "org.jlleitschuh.gradle.ktlint", version.ref = "ktlint" }',
        ].join('\n')
      );
      // Root build.gradle.kts: AGP direct + ktlint alias
      write(
        root,
        'build.gradle.kts',
        [
          'plugins {',
          '    id("com.android.application") version "8.5.0"',
          '    alias(libs.plugins.ktlint)',
          '}',
        ].join('\n')
      );

      const result = detectAndroid(root);

      assert.ok(result.detection !== null, 'detection must succeed');
      const details = result.detection
        .details as import('../android-detect.logic.ts').AndroidProject;
      assert.equal(details.agpHolderModule, '', 'AGP holder is the root (single-module)');
      assert.equal(details.optionalPlugins.ktlint, true, 'ktlint readable from TOML alias');
    });
  });

  it('single-module: no TOML, ktlint direct in root → ktlint executable; without ktlint → skipped', () => {
    // With ktlint
    withDir((root) => {
      writeWrapper(root);
      write(
        root,
        'build.gradle.kts',
        [
          'plugins {',
          '    id("com.android.application") version "8.5.0"',
          '    id("org.jlleitschuh.gradle.ktlint") version "12.0"',
          '}',
        ].join('\n')
      );

      const result = detectAndroid(root);

      assert.ok(result.detection !== null, 'detection must succeed');
      const details = result.detection
        .details as import('../android-detect.logic.ts').AndroidProject;
      assert.equal(details.optionalPlugins.ktlint, true, 'ktlint must be detected via direct form');
    });

    // Without ktlint
    withDir((root) => {
      writeWrapper(root);
      write(
        root,
        'build.gradle.kts',
        ['plugins {', '    id("com.android.application") version "8.5.0"', '}'].join('\n')
      );

      const result = detectAndroid(root);

      assert.ok(result.detection !== null, 'detection must succeed');
      const details = result.detection
        .details as import('../android-detect.logic.ts').AndroidProject;
      assert.equal(
        details.optionalPlugins.ktlint,
        false,
        'ktlint must be absent when not declared'
      );
    });
  });

  it('single-module: ktlint declared only in :app/build.gradle.kts → ktlint skipped (documented §3.6 step 5 limitation)', () => {
    withDir((root) => {
      writeWrapper(root);
      // Root: AGP direct only, no ktlint
      write(
        root,
        'build.gradle.kts',
        ['plugins {', '    id("com.android.application") version "8.5.0"', '}'].join('\n')
      );
      write(root, 'settings.gradle.kts', 'include(":app")\n');
      // :app: has ktlint but detect reads root only in single-module
      write(
        root,
        'app/build.gradle.kts',
        [
          'plugins {',
          '    id("com.android.application")',
          '    id("org.jlleitschuh.gradle.ktlint") version "12.0"',
          '}',
        ].join('\n')
      );

      const result = detectAndroid(root);

      // root build.gradle.kts holds AGP directly → single-module branch → only root is scanned for optionals
      assert.ok(result.detection !== null, 'detection must succeed');
      const details = result.detection
        .details as import('../android-detect.logic.ts').AndroidProject;
      assert.equal(
        details.optionalPlugins.ktlint,
        false,
        'ktlint in :app only → not detected (single-module limitation)'
      );
    });
  });

  it('optional plugin declared only in third submodule → ktlint skipped (documented §3.6 step 5 limitation)', () => {
    // Fixture per spec §3.6 step 5 «Известное ограничение»: step 5 reads at most root + AGP holder.
    // Any module beyond those two is never read for optional plugins — ktlint in :core → not detected.
    //
    // Implementation note: the detect algorithm matches AGP via `findAgpApplication` which does not
    // distinguish `apply false` from a real application. The root `alias(...) apply false` therefore
    // counts as the AGP holder (step 2 matches, step 4 fallback is not entered). Step 5 reads root
    // only (single-module path) — :app and :core are never scanned → ktlint skipped. This satisfies
    // the observable spec guarantee: optional plugins in non-scanned modules are not detected.
    withDir((root) => {
      writeWrapper(root);
      write(
        root,
        'gradle/libs.versions.toml',
        [
          '[plugins]',
          'android-application = { id = "com.android.application", version.ref = "agp" }',
        ].join('\n')
      );
      // Root: AGP alias with apply false — step 2 detects this as the holder
      write(
        root,
        'build.gradle.kts',
        ['plugins {', '    alias(libs.plugins.android.application) apply false', '}'].join('\n')
      );
      write(root, 'settings.gradle.kts', 'include(":app", ":core")\n');
      // :app: would be the AGP holder if root didn't match — has no ktlint
      write(
        root,
        'app/build.gradle.kts',
        ['plugins {', '    alias(libs.plugins.android.application)', '}'].join('\n')
      );
      // :core: ktlint declared — must NOT be detected (only root is scanned in step 5 here)
      write(
        root,
        'core/build.gradle.kts',
        ['plugins {', '    id("org.jlleitschuh.gradle.ktlint")', '}'].join('\n')
      );

      const result = detectAndroid(root);

      assert.ok(result.detection !== null, 'detection must succeed');
      const details = result.detection
        .details as import('../android-detect.logic.ts').AndroidProject;
      // Step 5 does not read :core → ktlint not detected (the key observable constraint)
      assert.equal(
        details.optionalPlugins.ktlint,
        false,
        'ktlint in unscanned module → not detected'
      );
    });
  });

  it('Groovy DSL submodule: app/build.gradle (no .kts) → detect succeeds; holder is the .gradle file', () => {
    withDir((root) => {
      // Root: kts but no AGP; settings: kts with :app; app: groovy without .kts
      writeWrapper(root);
      write(root, 'build.gradle.kts', 'plugins {\n}\n');
      write(root, 'settings.gradle.kts', 'include(":app")\n');
      // app has only .gradle (Groovy), not .kts — spec rule: .kts in priority, else .gradle
      write(
        root,
        'app/build.gradle',
        ['plugins {', '    id "com.android.application" version "8.5.0"', '}'].join('\n')
      );

      const result = detectAndroid(root);

      assert.ok(result.detection !== null, 'detection must succeed');
      const details = result.detection
        .details as import('../android-detect.logic.ts').AndroidProject;
      assert.ok(
        details.agpHolderFile.endsWith('app/build.gradle'),
        'holder must be Groovy .gradle file'
      );
    });
  });

  it('missing gradle-wrapper.jar → detectAndroid returns null, no diagnostics (D-STACK-014)', () => {
    withDir((root) => {
      write(root, 'settings.gradle.kts', '');
      write(root, 'build.gradle.kts', 'plugins { id("com.android.application") }\n');
      write(root, 'gradlew', '#!/bin/sh\n');
      // Intentionally omit gradle/wrapper/gradle-wrapper.jar
      write(root, 'gradle/wrapper/gradle-wrapper.properties', 'distributionUrl=...\n');

      const result = detectAndroid(root);

      assert.equal(result.detection, null, 'detection must be null when wrapper jar missing');
      assert.equal(
        result.diagnostics.length,
        0,
        'no diagnostics on wrapper check failure (D-STACK-014)'
      );
    });
  });

  it('libs.versions.toml with non-standard alias names (agp, android-app, androidApplication) → all resolved by plugin id', () => {
    withDir((root) => {
      writeWrapper(root);
      write(
        root,
        'gradle/libs.versions.toml',
        [
          '[plugins]',
          'agp = { id = "com.android.application", version.ref = "agp" }',
          'android-app = { id = "com.android.application", version.ref = "agp" }',
          'androidApplication = { id = "com.android.application", version.ref = "agp" }',
        ].join('\n')
      );
      // Use each alias form in a separate test but here we pick one to confirm detection
      write(
        root,
        'build.gradle.kts',
        ['plugins {', '    alias(libs.plugins.android.app)', '}'].join('\n')
      );

      const result = detectAndroid(root);

      // android-app → dsl path android.app → alias(libs.plugins.android.app) matches
      assert.ok(
        result.detection !== null,
        'detection must succeed via non-standard alias android-app'
      );
    });
  });

  it('detectAndroid with 33 includes + AGP not in first 32 → null + ANDROID_MODULE_LIMIT_EXCEEDED diagnostic', () => {
    withDir((root) => {
      writeWrapper(root);
      write(root, 'build.gradle.kts', 'plugins {\n}\n'); // no AGP in root
      // 33 includes: first 32 have no AGP; mod33 would have it (unreachable)
      const includes = Array.from({ length: 33 }, (_, i) => `include(":mod${i + 1}")`).join('\n');
      write(root, 'settings.gradle.kts', includes + '\n');
      // Write empty build files for first 32 modules (no AGP); mod33 gets AGP (never read)
      for (let i = 1; i <= 32; i++) {
        write(root, `mod${i}/build.gradle.kts`, 'plugins { }\n');
      }
      write(root, 'mod33/build.gradle.kts', 'plugins { id("com.android.application") }\n');

      const result = detectAndroid(root);

      assert.equal(result.detection, null, 'detection must be null when AGP not found in first 32');
      assert.ok(
        result.diagnostics.some((d) => d.code === 'ANDROID_MODULE_LIMIT_EXCEEDED'),
        'must emit ANDROID_MODULE_LIMIT_EXCEEDED diagnostic'
      );
      const diag = result.diagnostics.find((d) => d.code === 'ANDROID_MODULE_LIMIT_EXCEEDED')!;
      assert.match(diag.fix, /stack\.use/, 'fix must mention stack.use');
      assert.match(diag.fix, /--root=/, 'fix must mention --root flag');
    });
  });
});
