# Task: TSK-95 — stack library: types, config, registry, runner, node+golang plugins

<!--SECTION:META-->

## 1. Meta

- **Task-ID:** TSK-95
- **Status:** [x] DONE
- **Purpose:** Библиотечный слой плагинной системы стеков: общий интерфейс `StackPlugin`, реестр, конфиг `.gennadyrc#stack`, стек-агностичный раннер гейтов, встроенные плагины `node` и `golang`.
- **Scope:** `stack`
- **Module:** `services/stack`
- **Dependencies:** None
- **Spec References:** FR-STACK-01, FR-STACK-02, FR-STACK-04, FR-STACK-05, FR-STACK-06, FR-STACK-07, FR-STACK-08, FR-STACK-09, D-STACK-001..006
- **Runtime Backing:** `real-runtime`
- **Verification Levels:** `unit`
<!--/SECTION:META-->

<!--SECTION:PHASES_OVERVIEW-->

## 2. Phases Overview

| ID  | Kind | Deps | Status   |
| --- | ---- | ---- | -------- |
| P1  | impl | —    | [x] DONE |
| P2  | test | P1   | [x] DONE |

### P1 — impl

- **Objective:** Типы closed-world (`stack.types.ts`), `loadStackConfig`/`applyStackConfig` поверх расширенного `GennadyRc`, `detectStacks` + `BUILTIN_STACK_PLUGINS`, `runVerify`/`formatVerifyReport` (RUN-ALL, SUPPRESS-ON-SUCCESS, `outputMeansFailure`, декларативные `envFail`-правила, усечение вывода), `nodePlugin` (порт эвристики classify-scripts), `golangPlugin` (detect/scope/plan: vendor-режим, `-c` для конфига без точки, скоуп от базовой ветки, диагностика version skew и nested modules).
- **Target Files:**
  - `services/stack/stack.types.ts` (NEW)
  - `services/stack/stack-config.ts` (NEW)
  - `services/stack/stack-registry.ts` (NEW)
  - `services/stack/gate-runner.ts` (NEW)
  - `services/stack/plugins/node/node-plugin.ts` (NEW)
  - `services/stack/plugins/node/classify-npm-scripts.ts` (NEW)
  - `services/stack/plugins/golang/golang-plugin.ts` (NEW)
  - `services/stack/plugins/golang/golang-detect.logic.ts` (NEW)
  - `services/stack/plugins/golang/golang-scope.logic.ts` (NEW)
  - `services/stack/plugins/golang/golang-plan.logic.ts` (NEW)
  - `shared/backend/rc/rc-config.ts` (MOD — опциональная секция `stack`, объект без `models` валиден)

### P2 — test

- **Objective:** Unit-тесты: контракт раннера (RUN-ALL, stdout-контракт, env-fail, skip, усечение), применение конфига (overrides → skip → extraGates, битый JSON, неизвестный id в `use`), golang detect/scope/plan (fixtures во временных директориях), node-классификатор.
- **Target Files:**
  - `services/stack/__tests__/gate-runner.test.ts` (NEW)
  - `services/stack/__tests__/stack-config.test.ts` (NEW)
  - `services/stack/plugins/golang/__tests__/golang-detect.test.ts` (NEW)
  - `services/stack/plugins/golang/__tests__/golang-scope.test.ts` (NEW)
  - `services/stack/plugins/golang/__tests__/golang-plan.test.ts` (NEW)
  - `services/stack/plugins/node/__tests__/node-plugin.test.ts` (NEW)
  <!--/SECTION:PHASES_OVERVIEW-->

## 5. Verification

| Command                                                                                                    | Required by      |
| ---------------------------------------------------------------------------------------------------------- | ---------------- |
| `npm run type-check`                                                                                       | typescript-rules |
| `npx tsx cli/gennady.ts lint services/stack/ shared/backend/rc/`                                           | dbc-contracts    |
| `node --import tsx --test services/stack/__tests__/*.test.ts services/stack/plugins/*/__tests__/*.test.ts` | node-test        |

<!--SECTION:EXECUTION_LOG-->

## 7. Execution Log

| Round | Date       | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1    | 2026-08-17 | PASS   | Library implemented per spec. Ported golang logic from the reverted go-verify prototype into plugin shape; env-fail rules moved from runner into gate declarations per D-STACK-004. rc-config extended: object without `models` is now valid. All unit suites pass; type-check + DbC lint clean. Verified live on mailapi (vendored, bare golangci.yml, go-version-skew diagnostic) and cloudapi (nested modules, missing-config diagnostic). |

<!--/SECTION:EXECUTION_LOG-->
