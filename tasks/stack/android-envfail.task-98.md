# Task: TSK-98 — stack: android envFail predicates (JDK/AGP skew, Gradle daemon crash, blocked Maven proxy)

<!--SECTION:META-->

## 1. Meta

- **Task-ID:** TSK-98
- **Status:** [x] DONE
- **Purpose:** Достать android-гейты до контракта §8.2: `envFail`-предикаты обязательны на `assemble`/`lint`/`test`/`ktlint`/`detekt`/`spotless`; без них типовые мобильные условия (JDK × AGP skew, срыв Gradle daemon, блокированный Maven/Gradle proxy, паника Kotlin compiler) маскируются под FAIL и приводят агента к «фиксу» кода в ответ на env-проблему. Реализация — константы `ANDROID_TOOL_ENV_FAIL` / `ANDROID_TEST_ENV_FAIL` из библиотечных комбинаторов (`outputMatches`), проброс в `planAndroidGates` симметрично golang.
- **Scope:** `stack`
- **Module:** `services/stack`
- **Dependencies:** TSK-97 (android plugin)
- **Spec References:** FR-STACK-15, §4.2 (Gate.envFail), §8.2 (Gate Runner postconditions — env-fail), D-STACK-004 (env-fail = предикаты, не знания в раннере), D-STACK-017 (probe в detect не делаем — ловим на гейте), D-STACK-019 (нормативный набор предикатов)
- **Runtime Backing:** `real-runtime`
- **Verification Levels:** `unit`
<!--/SECTION:META-->

<!--SECTION:PHASES_OVERVIEW-->

## 2. Phases Overview

| ID  | Kind | Deps | Status |
| --- | ---- | ---- | ------ |
| P1  | impl | —    | [x] DONE |
| P2  | test | P1   | [x] DONE |

### P1 — impl

- **Objective:**
  - `plugins/android/android-plan.logic.ts` (MOD): импорт `outputMatches` из `../../gate-runner.ts` и типа `EnvFailPredicate` из `../../stack.types.ts`; объявить локальные константы предикатов по D-STACK-019:
    - `ANDROID_TOOL_ENV_FAIL: readonly EnvFailPredicate[]` — покрывает assemble/lint/ktlint/detekt/spotless: `Unsupported class file major version`, `requires Java \d+ to run`, `Minimum supported Gradle version is`, `Gradle build daemon disappeared`, `The daemon has stopped unexpectedly`, `Could not (resolve|GET|download|find)`, `dial tcp.*(i\/o timeout|no such host|connection refused)`, `Received status code 4\d\d`, `KotlinFrontEndException|Internal compiler error`. Каждый предикат несёт `hint` через второй аргумент `outputMatches` там, где действие оператора неочевидно (пример: JDK-skew → «install a JDK compatible with AGP <version>, or configure toolchain in build.gradle{.kts}»).
    - `ANDROID_TEST_ENV_FAIL: readonly EnvFailPredicate[]` — тот же набор **без** `KotlinFrontEndException|Internal compiler error` (D-STACK-019: паника compiler'а под тестом — compiler-баг, но `AssertionError` под тестом — genuine FAIL; не заматчить последнее).
  - `planAndroidGates` (MOD): в цикле по BASE_GATES ставить `envFail: id === 'test' ? ANDROID_TEST_ENV_FAIL : ANDROID_TOOL_ENV_FAIL`; в цикле по OPTIONAL_GATES ставить `envFail: ANDROID_TOOL_ENV_FAIL` только на **executable**-ветке (когда `present === true`); skipped-гейты `envFail` не несут (пустой argv не будет запущен). Обновить `@invariant` JSDoc функции: `no envFail` → «envFail: ANDROID_TOOL_ENV_FAIL for assemble/lint/optional; ANDROID_TEST_ENV_FAIL for test; skipped gates without envFail».

- **Target Files:**
  - `services/stack/plugins/android/android-plan.logic.ts` (MOD)

### P2 — test

- **Objective:** Unit-тесты через `runVerify` с моком `spawnSync` — наблюдаемый результат `VerifyReport.results[].status`.
  - `Unsupported class file major version 65` в stderr → gate `assemble` = `env-fail`
  - `Could not resolve com.android.tools:desugar_jdk_libs` в stderr → gate `lint` = `env-fail`
  - `AssertionError: expected X got Y` в stdout под gate `test` → `fail` (не env-fail; проверка что тестовый набор `ANDROID_TEST_ENV_FAIL` не заматчил test-код)
  - `KotlinFrontEndException` на gate `assemble` → `env-fail`
  - `KotlinFrontEndException` на gate `test` → `fail` (симметрия golang `GO_TEST_ENV_FAIL` — паника кода под тестом genuine)
  - `The daemon has stopped unexpectedly` на gate `ktlint` (optional, executable) → `env-fail`
  - `Received status code 403 from server: Forbidden` на gate `assemble` → `env-fail`
  - `Gradle 8.4 requires Java 17 to run. You are currently using Java 11` → `env-fail`
  - Все `env-fail` кейсы: результат гейта содержит `hint` от `outputMatches` (второй аргумент), если он объявлен на предикате.

- **Target Files:**
  - `services/stack/plugins/android/__tests__/android-plan.test.ts` (MOD — добавить env-fail suite)
<!--/SECTION:PHASES_OVERVIEW-->

## 5. Verification

| Command                                                                                        | Required by      |
| ---------------------------------------------------------------------------------------------- | ---------------- |
| `npm run type-check`                                                                           | typescript-rules |
| `npx tsx cli/gennady.ts lint services/stack/`                                                  | dbc-contracts    |
| `node --import tsx --test services/stack/plugins/android/__tests__/android-plan.test.ts`       | node-test        |

<!--SECTION:EXECUTION_LOG-->

## 7. Execution Log

| Round | Date | Status | Notes |
| ----- | ---- | ------ | ----- |

### Round 1 — 2026-08-19, initial

#### P1

- [x] `2026-08-19T00:00:00Z` intro `ANDROID_TOOL_ENV_FAIL` + `ANDROID_TEST_ENV_FAIL` в `android-plan.logic.ts` — regex-предикаты через `outputMatches` combinators согласно D-STACK-019.
- [x] `2026-08-19T00:00:00Z` MOD `planAndroidGates` — `envFail` на всех executable base + optional; test-гейт использует subset без `KotlinFrontEndException` predicate; skipped optional не несёт envFail.
- [x] `2026-08-19T00:00:00Z` insight JSDoc `@invariant` превысил 25 слов → gennady lint (WORD_COUNT). Сокращено до 22 слов, семантика сохранена.
- [x] `2026-08-19T00:00:00Z` ver `npm run type-check` → pass exit=0
- [x] `2026-08-19T00:00:00Z` ver `npx tsx cli/gennady.ts lint services/stack/` → pass exit=0
- [x] `2026-08-19T00:00:00Z` DONE

**Handoff →** artifacts: [services/stack/plugins/android/android-plan.logic.ts]; decisions: [envfail=predicates-per-D-STACK-019, test-subset=excludes-compiler-panic, skipped-optional=no-envfail]; open: []

#### P2

- [x] `2026-08-19T00:00:00Z` intro env-fail suite (9 cases) в `android-plan.test.ts`: JDK skew, blocked Maven, daemon crash, 403, KotlinFrontEndException on assemble (env-fail) vs test (fail), AssertionError under test (fail), optional executable вьёт envFail vs skipped не вьёт.
- [x] `2026-08-19T00:00:00Z` ver `node --import tsx --test services/stack/plugins/android/__tests__/android-plan.test.ts` → 17/17 pass exit=0
- [x] `2026-08-19T00:00:00Z` DONE

**Handoff →** artifacts: [services/stack/plugins/android/__tests__/android-plan.test.ts]; decisions: [test-coverage=9-envfail-cases-added]; open: []

#### Round close

- [x] `2026-08-19T00:00:00Z` sync stack+root trackers
- [x] `2026-08-19T00:00:00Z` DONE

<!--/SECTION:EXECUTION_LOG-->
