# Task: TSK-97 — stack: android plugin (detect + verify plan + sandboxLinks + cwd/UNSANDBOXED invariants)

<!--SECTION:META-->

## 1. Meta

- **Task-ID:** TSK-97
- **Status:** [ ] TODO
- **Purpose:** Третий встроенный `StackPlugin` — `android`: составной детект каноничной Gradle-раскладки (§3.6), гранулярный `verify`-план (`assemble → lint → test` + опциональные `ktlintCheck`/`detekt`/`spotlessCheck`), `sandboxLinks: ['.gradle', '.kotlin']`, диагностика `ANDROID_MODULE_LIMIT_EXCEEDED`. Раннер расширяется двумя инвариантами (`UNSANDBOXED_RUN` игнорирует `sandboxLinks`; `cwd` пересчитывается через relpath от git-корня — §8.2), тип `StackId` и реестр `BUILTIN_STACK_PLUGINS` — на `'android'`.
- **Scope:** `stack`
- **Module:** `services/stack`
- **Dependencies:** TSK-95 (типы, реестр, раннер, gate-runner), TSK-96 (CLI `verify`)
- **Spec References:** FR-STACK-02, FR-STACK-15, §3.6 (Android detect), §4.2 (Gate.cwd семантика), §8.2 (`sandboxLinks` при UNSANDBOXED_RUN, cwd/git-root relpath), §6 (Golden DX android), §12 (test-кейс список), D-STACK-014, D-STACK-015, D-STACK-016, D-STACK-017, D-STACK-018
- **Runtime Backing:** `real-runtime`
- **Verification Levels:** `unit`
<!--/SECTION:META-->

<!--SECTION:PHASES_OVERVIEW-->

## 2. Phases Overview

| ID  | Kind | Deps | Status  |
| --- | ---- | ---- | ------- |
| P1  | impl | —    | [ ] TODO |
| P2  | test | P1   | [ ] TODO |

### P1 — impl

- **Objective:**
  Библиотечный слой + плагин:
  - `stack.types.ts` (MOD): `StackId` → `'node' | 'golang' | 'android'`; комментарий `Gate.cwd` уточнён по §4.2 (плагин ставит real-tree путь, раннер пересчитывает); комментарий `sandboxLinks` расширен для android.
  - `stack-registry.ts` (MOD): `BUILTIN_STACK_PLUGINS = [nodePlugin, golangPlugin, androidPlugin]` (D-STACK-014).
  - `gate-runner.ts` (MOD): два новых инварианта (§8.2) — (1) при `UNSANDBOXED_RUN` `sandboxLinks` активных плагинов **игнорируются** и `cwd` **не пересчитывается**: `git rev-parse --show-toplevel` не вызывается (git отсутствует), `spawnSync` получает `gate.cwd` напрямую в координатах реального дерева; гейты работают в реальном дереве как есть, `.gradle/` реального дерева не тронут; (2) в нормальной ветке (реплика создаётся) `cwd` пересчитывается через `git rev-parse --show-toplevel` → `relpath(gate.cwd, git-root)` → `<replica>/<relpath>`, что также нужно для канонического мобильного монорепо (`--root=android`, D-STACK-010); path-rewrite в выводе учитывает тот же relpath.
  - `plugins/android/android-plugin.ts` (NEW): `StackPlugin` с `id: 'android'`, `marker: 'settings.gradle{.kts}'`, `sandboxLinks: ['.gradle', '.kotlin']` (D-STACK-016), `detect: detectAndroid`, `verify: { resolveScope, planGates: planAndroidGates }`.
  - `plugins/android/android-detect.logic.ts` (NEW): §3.6 полностью — шаг 1 (все 5 wrapper-файлов; отсутствие любого → `null`, без диагностики; D-STACK-014), шаг 2 (корневой `build.gradle{.kts}`: приоритет `.kts`, fallback `.gradle`; direct + alias форм), шаг 3 (alias resolver: сначала TOML, затем build.gradle, конвертация `-`/`_` → `.`; D-STACK-018), шаг 4 (fallback на подмодули из `settings.gradle{.kts}`, до 32; правило выбора файла то же; превышение → `null` + диагностика `ANDROID_MODULE_LIMIT_EXCEEDED`), шаг 5 (optional Gradle-плагины `org.jlleitschuh.gradle.ktlint` / `io.gitlab.arturbosch.detekt` / `com.diffplug.spotless` в single-module — только корневой; в multi-module — корневой + держатель AGP; TOML переиспользуется или читается здесь; ограничение задокументировано, не диагностика), шаг 6 (`StackDetection` + `details`). Граница ответственности: `detectAndroid` управляет пайплайном (какой файл читать, когда останавливаться), выполняет конвертацию `-`/`_` → `.` и поиск `alias(libs.plugins.<путь>)` в build.gradle{.kts}. `parseVersionCatalog` — чистая функция парсинга TOML: не знает о конвертации имён и не читает build.gradle.
  - `plugins/android/android-version-catalog.logic.ts` (NEW): `parseVersionCatalog(tomlPath): Map<alias-name, plugin-id>` — чистая функция, хэнд-парс регексом секции `[plugins]` (без нового npm-пакета, D-STACK-018): возвращает map alias-имён (в TOML-форме, до конвертации) на plugin-id из обеих форм `<alias> = { id = "…", … }` и `<alias> = "<id>:<version>"`. Конвертация имён и поиск в build.gradle — не эта функция.
  - `plugins/android/android-settings.logic.ts` (NEW): `parseSettingsGradle(path, limit=32)` — извлекает `include(":<module>")` / `include ':<module>'` регексом; возвращает первые `limit` подмодулей (D-STACK-014).
  - `plugins/android/android-plan.logic.ts` (NEW): `planAndroidGates(detection, scope, options)` (D-STACK-015) — базовые `assembleDebug`, `lintDebug`, `testDebugUnitTest`; опциональные `ktlintCheck`, `detekt`, `spotlessCheck` (см. `details.optionalPlugins` из `detectAndroid`) → `skipped: 'плагин <id> не подключён'` если не найден; per-gate timeouts (`assemble: 10m`, `lint: 5m`, `test: 10m`, optional: 5m); скоуп репо-уровневый (Gradle-таск, D-STACK-006).

- **Target Files:**
  - `services/stack/stack.types.ts` (MOD — `StackId`, `Gate.cwd` doc, `sandboxLinks` doc)
  - `services/stack/stack-registry.ts` (MOD — регистрация `androidPlugin`)
  - `services/stack/gate-runner.ts` (MOD — `UNSANDBOXED_RUN` игнорирует `sandboxLinks`; cwd relpath pre-`spawnSync`)
  - `services/stack/plugins/android/android-plugin.ts` (NEW)
  - `services/stack/plugins/android/android-detect.logic.ts` (NEW)
  - `services/stack/plugins/android/android-version-catalog.logic.ts` (NEW)
  - `services/stack/plugins/android/android-settings.logic.ts` (NEW)
  - `services/stack/plugins/android/android-plan.logic.ts` (NEW)

### P2 — test

- **Objective:** Unit-тесты (real-runtime `unit`; fixtures во временных директориях с реальным `git init` там, где нужен git-root); все проверки — через наблюдаемый результат (`StackDetection` / `Gate[]` / `VerifyReport`), не через путь вызова.

  Кейсы детекта (все — `android-detect.test.ts` кроме отмеченных):
  - каноничная multi-module раскладка (AGP через `alias(libs.plugins.android.application)` в `:app`, ktlint `apply false` в корне) → detect success, `android:ktlint` `executable`
  - single-module ветка (AGP direct-формой в корне, ktlint alias-формой через `libs.versions.toml`) → detect success, `android:ktlint` `executable` — наблюдаемая проверка TOML-чтения на шаге 5
  - single-module ветка, TOML отсутствует, ktlint direct-формой в корне → `android:ktlint` `executable`; без ktlint → `skipped`
  - single-module ветка (AGP direct в корне) + ktlint объявлен **только** в `:app/build.gradle.kts` → `android:ktlint` `skipped` (задокументированное ограничение §3.6 шаг 5 «Уточнение single-module»)
  - Optional-плагин, объявленный **только в третьем submodule** → `android:ktlint` `skipped` (задокументированное ограничение §3.6 шаг 5 «Известное ограничение»). Fixture-состав обязателен для проверки самого ограничения (иначе тест-тавтология): корневой `build.gradle.kts` — `alias(libs.plugins.android.application) apply false`, **без** ktlint; `settings.gradle.kts` c `include(":app", ":core")`; `:app/build.gradle.kts` — держатель AGP (`alias(libs.plugins.android.application)`), **без** ktlint; `:core/build.gradle.kts` — ktlint plugin declared (`id("org.jlleitschuh.gradle.ktlint")` direct-формой); детект проходит fallback шагом 4 в `:app`, шаг 5 читает корневой + `:app`, `:core` не читается → ktlint не детектирован → `skipped`
  - Groovy DSL submodule: fixture с корневым build.gradle.kts (без AGP), settings.gradle.kts с `include(":app")`, файл `app/build.gradle` (Groovy, AGP direct-формой) **и отсутствующим** `app/build.gradle.kts` → детект успешен, держатель AGP — `app/build.gradle` (наблюдаемая проверка правила «`.kts` в приоритете, иначе `.gradle`» шага 4)
  - отсутствующий `gradle-wrapper.jar` → `detectAndroid` возвращает `null`, диагностики нет (D-STACK-014)
  - `libs.versions.toml` с нестандартными alias-именами (`agp`, `android-app`, `androidApplication`) → резолвинг по полю `id` находит все три
  - `parseSettingsGradle` на 33 include-модулях → возвращает список из 32 первых (`android-settings.test.ts`)
  - `detectAndroid` на 33 include, AGP не найден ни в одном из первых 32 → `null` + диагностика `ANDROID_MODULE_LIMIT_EXCEEDED` с подсказкой `stack.use: [android]` + `--root=<путь>`

  Кейсы раннера (`gate-runner.test.ts` MOD):
  - `runVerify` в поддиректории git-корня (git init в parent, `--root=<parent>/android`): реплика создаётся от git-корня; проверяемые observable инварианты (все обязательны, не «либо-либо»):
    (a) `spawnSync` получает `cwd == <replica>/android` — фиксируется через spy на `spawnSync`-опции (**не** через реальный процесс `pwd` — прямой доступ к аргументу гарантирует, что тест наблюдает именно раннер, а не поведение шелла);
    (b) **path-rewrite в выводе** (§8.2 postconditions + P1 MOD-требование): `VerifyReport.results[].output` содержит `<real>/android/…`, а **не** `<replica>/android/…` — раннер обязан переписать пути реплики обратно на реальные с учётом того же relpath. **Форма stub**: `spawnSync`-мок обязан вернуть в `stdout` строку, содержащую путь реплики (например `${replica}/android/src/main/App.kt:10: error`), иначе тест ложно-положителен — раннер, полностью не реализовавший path-rewrite, всё равно пройдёт. Assert: `output` содержит `<real>/android/src/main/App.kt:10:`, `output` не содержит `<replica>/android/` (или содержимого `replica-корня`).
  - `UNSANDBOXED_RUN` (fixture-директория без `.git`) + активный плагин с непустым `sandboxLinks` (стабовый android-подобный плагин): observable инварианты (все обязательны):
    (a) раннер печатает диагностику `UNSANDBOXED_RUN`;
    (b) `createTreeReplica` **не вызывается** (spy или отсутствие worktree-директорий на файловой системе после прогона);
    (c) `git rev-parse` **не вызывается** (spy на `spawnSync`/exec);
    (d) `spawnSync` получает `cwd == gate.cwd` (реальный путь без пересчёта);
    (e) fixture-директория `.gradle/` (создана до теста с sentinel-файлом) не изменена — sentinel-файл присутствует, никаких symlink'ов не появилось;
    (f) `VerifyReport.results[].output` содержит **реальный путь** fixture-директории, не содержит подстрок `/tmp/worktree-` или иных признаков path-rewrite (при UNSANDBOXED пути не переписываются — их нечем переписывать; ошибочная реализация может подставить фантомный replica-путь)

  Кейсы плана:
  - `planAndroidGates` без optional-плагинов в детекте → базовые 3 гейта executable, optional 3 → `skipped: 'плагин … не подключён'`
  - per-gate `timeoutMs > 0` для всех executable гейтов
  - `resolveScope('changed')` для android возвращает репо-уровневый scope с note (D-STACK-006 симметрия с node)

- **Target Files:**
  - `services/stack/plugins/android/__tests__/android-detect.test.ts` (NEW)
  - `services/stack/plugins/android/__tests__/android-version-catalog.test.ts` (NEW)
  - `services/stack/plugins/android/__tests__/android-settings.test.ts` (NEW)
  - `services/stack/plugins/android/__tests__/android-plan.test.ts` (NEW)
  - `services/stack/__tests__/gate-runner.test.ts` (MOD — 2 новых кейса: cwd relpath из subdir git-корня; `UNSANDBOXED_RUN` игнорирует `sandboxLinks`)
  <!--/SECTION:PHASES_OVERVIEW-->

## 5. Verification

| Command                                                                                                                                            | Required by      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `npm run type-check`                                                                                                                               | typescript-rules |
| `npx tsx cli/gennady.ts lint services/stack/`                                                                                                      | dbc-contracts    |
| `node --import tsx --test services/stack/__tests__/gate-runner.test.ts services/stack/plugins/android/__tests__/*.test.ts`                         | node-test        |

<!--SECTION:EXECUTION_LOG-->

## 7. Execution Log

| Round | Date | Status | Notes |
| ----- | ---- | ------ | ----- |

<!--/SECTION:EXECUTION_LOG-->
