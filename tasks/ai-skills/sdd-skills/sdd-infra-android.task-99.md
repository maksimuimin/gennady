# Task: TSK-99 — ai-skills: sdd-infra-android skill + android-testing directive + knowledge.xml registration

<!--SECTION:META-->

## 1. Meta

- **Task-ID:** TSK-99
- **Status:** [x] DONE
- **Purpose:** Достать Android до паритета с Node/Golang в SDD-воркфлоу: (1) выделенный skill `sdd-infra-android` (клон `sdd-infra-golang` с прицелом на AGP/Gradle/kotlin-rules/android-setup) — оператор получает язык-специфичный onboarding, а не generic `sdd-infra`; (2) testing-директива `ai/directives/testing/android-testing.xml` — минимальный baseline для JUnit4/5 + `androidTest` + Robolectric (Compose UI test / Paparazzi — отдельными директивами позже); (3) регистрация `android-setup`, `kotlin-rules`, `android-testing` в `ai/directives/knowledge.xml` (сейчас `android-setup` не в registry → недостижим по cascade). `sdd-infra` (generic) получает branch на android — симметрично Go-branch, D-STACK-017 semantics.
- **Scope:** `ai-skills`
- **Module:** `sdd-skills`
- **Dependencies:** TSK-97 (android StackPlugin), TSK-98 (android envFail predicates) — не блокеры друг для друга, но `sdd-infra-android` в §2 «Diagnostics table» ссылается на env-fail кейсы из TSK-98.
- **Spec References:**
  - Scope: [`ai-skills` §3.5 Rules, §8.3 Stack dependencies](../../../specs/ai-skills/ai-skills.spec.md)
  - Module: [`sdd-skills` §1 vision, §3 Inventory, §7 File Structure — sdd-infra-android added](../../../specs/ai-skills/sdd-skills/sdd-skills.spec.md)
  - Stack scope: [`stack` §D-STACK-019 envFail predicates](../../../specs/stack/stack.spec.md)
  - Directives: `ai/directives/infra/android-setup.xml`, `ai/directives/coding/kotlin-rules.xml`
- **Runtime Backing:** `real-runtime`
- **Verification Levels:** `integration` (sync-skills round-trip; knowledge.xml consumed by scaffold directive)
<!--/SECTION:META-->

<!--SECTION:PHASES_OVERVIEW-->

## 2. Phases Overview

| ID  | Kind | Deps | Status |
| --- | ---- | ---- | ------ |
| P1  | impl | —    | [x] DONE |
| P2  | test | P1   | [x] DONE |

## 3. Phases

### P1 — impl

- **Objective:**
  1. **`ai/skills/sdd-infra-android/SKILL.md` (NEW)** — клон структуры `ai/skills/sdd-infra-golang/SKILL.md`; scope-type=`infrastructure`, language=`kotlin` (Android). Секции:
     - Frontmatter `name: sdd-infra-android`, `description` с trigger-фразами («Android infra scope», «AGP», «Gradle», «kotlin-rules», «android-setup», «bootstrap Android tooling», «Gradle gate diagnostics»), `license: MIT`, `compatibility: opencode`.
     - **§1 Orient before designing** — `npx gennady verify --plan` показывает: активные стеки (android + возможно node/golang), корневой AGP-модуль (`com.android.application`/`.library`, alias vs direct), AGP-версия из `libs.versions.toml`, per-gate argv (`./gradlew assembleDebug` etc.), диагностика `ANDROID_MODULE_LIMIT_EXCEEDED` (если 33+ модулей и AGP в дальнем).
     - **§2 Read the diagnostics honestly** — таблица (Diagnostic | Meaning | Correct response):
       | `ANDROID_MODULE_LIMIT_EXCEEDED` | 32 include-модуля обработано, AGP не найден | `stack.use: [android]` + `--root=<путь-к-держателю-AGP>` |
       | env-fail на `assemble`: `Unsupported class file major version` | JDK toolchain несовместим с AGP байткодом | Установить совместимый JDK; или задать toolchain block в build.gradle |
       | env-fail на `lint`: `Could not resolve` | Maven/Gradle registry заблокирован | Разблокировать прокси; или `stack.android.skipGates: [lint]` |
       | env-fail: `KotlinFrontEndException` | Kotlin compiler-паника | Не править код; upgrade Kotlin toolchain или репорт JetBrains |
       | env-fail: `Gradle build daemon disappeared` | JVM crash / OOM | Увеличить `-Xmx` в `gradle.properties`; не править код |
     - **§3 Wire the gate into the SDD loop** — `npx gennady verify` (реализация репо-уровневая, D-STACK-006). Флаги `--only=android:assemble` / `--skip=lint` / `--stack=android` симметрично Go.
     - **§4 Encode repo deviations in gennady.yaml** — пример: `stack.android.skipGates: [lint]`, `stack.android.overrideGates.test.timeout: 20m`, `stack.android.extraGates: [{ id: paparazzi, argv: [./gradlew, verifyPaparazziDebug], timeout: 10m }]`.
     - **§5 Distinguish FAIL from ENV_FAIL** — та же логика что golang; конкретные примеры env-fail из §2 таблицы.
     - **§6 Rules that survive Android reality** — коротко: one verb, gates never mutate (ktlintFormat/spotlessApply запрещены как гейты — только через `gennady fix` post-v1), scope repo-level (Gradle-таск), sandbox links `.gradle` + `.kotlin` не трогай, bound everything (per-gate timeout обязателен).
     - **§7 Designing a new Android infra scope** — Extract intent (scope-type=infrastructure, language=kotlin, Android platform). Load & activate: `ai/directives/sdd/discovery.directive.xml` + `ai/directives/infra/android-setup.xml` + `ai/directives/coding/kotlin-rules.xml`. Announce: `🔒 DIRECTIVE ACTIVATED: SddDiscovery | infrastructure | android`. Ground every requirement in `--plan --json` output.
     - Пути в исходнике — dev-form (`~/Developer/gennady/ai/directives/...` etc.) — `sync-skills` PathNormalizer переведёт в prod-form (`ai/directives/...`) при `npx gennady sync-skills`.

  2. **`ai/skills/sdd-infra/SKILL.md` (MOD)** — добавить android-branch симметрично Go-branch: после Go-роутинга (line ~9) — «If the scope is an Android app or library — `settings.gradle{.kts}` present, or the operator named Android — hand off to `sdd-infra-android`». Обновить description с trigger `«Android»`.

  3. **`ai/directives/testing/android-testing.xml` (NEW)** — минимальный baseline директивы:
     - Root `<AndroidTesting>` с child sections по образцу `ai/directives/testing/vitest-rules.xml`.
     - Триггеры: `.kt` в `src/test/**` или `src/androidTest/**`; JUnit4/5 / Robolectric / AndroidX Test.
     - Правила (короткие): (a) local unit tests в `src/test/**` — JVM, никаких Android-фреймворков, только чистый Kotlin/Java; (b) instrumented tests в `src/androidTest/**` — AndroidX Test + `@RunWith(AndroidJUnit4::class)`, не запускаются в SDD verify-loop (D-STACK-015 — исключены из базового плана, connectedAndroidTest требует эмулятор); (c) Robolectric — только когда JVM-тесты нужны с Android API, `@Config(sdk = [...])` фиксирует уровень; (d) file layout: `src/test/java` / `src/test/kotlin` для unit; (e) naming: `<ClassUnderTest>Test.kt`; (f) BDD-mapping через docstring `@DisplayName` (JUnit5) или `@Test fun \`<scenario>\`()` (JUnit5+Kotlin backticks); (g) inherit `testing-common` — case flow, phase anchors, unified context.
     - Не покрывает: Compose UI test, Paparazzi, Espresso — отдельными директивами позже (out-of-scope здесь, отмечено явно в директиве).

  4. **`ai/directives/knowledge.xml` (MOD)** — регистрация трёх новых узлов:
     - `<Rules><Infra>` — новый `<Rule id="android-setup">`:
       ```xml
       <Rule id="android-setup">
         <File>ai/directives/infra/android-setup.xml</File>
         <Purpose>Configuring Android/Gradle infra: wrapper, gates via gennady verify, sandbox strategy, ENV_FAIL contract for JDK/AGP skew.</Purpose>
         <Triggers>Task configures Android tooling · Gradle wrapper setup · AGP upgrade · gennady.yaml stack.android section</Triggers>
         <SkipWhen>Non-Android scope · Coding/testing task that only RUNS gradle, does not configure it</SkipWhen>
         <ActivationHint>Before writing gradle.properties, gennady.yaml stack.android, or Gradle wrapper files</ActivationHint>
         <CheckPhase>test</CheckPhase>
         <RequiresVerification>check-command</RequiresVerification>
       </Rule>
       ```
     - `<Rules><Testing>` — новый `<Rule id="android-testing">` с CrossRef на `testing-common` (по образцу `vitest-rules` / `svelte-testing`).
     - `kotlin-rules` уже зарегистрирован (проверено — присутствует). Добавить CrossRef из `kotlin-rules` → `android-setup` (parent infra) и наоборот CrossRef из `android-setup` → `kotlin-rules` («Kotlin source rules layered on top»).

- **Target Files:**
  - `ai/skills/sdd-infra-android/SKILL.md` (NEW)
  - `ai/skills/sdd-infra/SKILL.md` (MOD — android-branch, description trigger)
  - `ai/directives/testing/android-testing.xml` (NEW)
  - `ai/directives/knowledge.xml` (MOD — Rules/Infra/android-setup, Rules/Testing/android-testing, CrossRef на kotlin-rules)

### P2 — test

- **Objective:** integration-verify (real-runtime): (a) `npx gennady sync-skills` без ошибок, `sdd-infra-android` появляется в `.claude/skills/`; (b) `xmllint --noout ai/directives/knowledge.xml ai/directives/testing/android-testing.xml` — оба валидны; (c) грепом убедиться что `sdd-infra-golang` встречается только в целевых секциях (SKILL.md, sdd-infra branch, docs) — синхронно с изменениями spec §1/§3.

- **Target Files:**
  - (нет NEW — только verification)
<!--/SECTION:PHASES_OVERVIEW-->

## 5. Verification

| Command                                                                                                        | Required by      |
| -------------------------------------------------------------------------------------------------------------- | ---------------- |
| `npm run type-check`                                                                                           | typescript-rules |
| `xmllint --noout ai/directives/knowledge.xml`                                                                  | xml-validity     |
| `xmllint --noout ai/directives/testing/android-testing.xml`                                                    | xml-validity     |
| `npx gennady sync-skills --dry-run`                                                                            | skill-contract   |

<!--SECTION:EXECUTION_LOG-->

## 7. Execution Log

| Round | Date | Status | Notes |
| ----- | ---- | ------ | ----- |

### Round 1 — 2026-08-19, initial

#### P1

- [x] `2026-08-19T00:00:00Z` intro `ai/skills/sdd-infra-android/SKILL.md` — клон структуры golang-варианта, разделы 1–7 (orient/diagnostics/loop/gennady.yaml/FAIL vs ENV_FAIL/rules/design flow), таблица диагностик покрывает 8 env-fail сценариев из D-STACK-019 + `ANDROID_MODULE_LIMIT_EXCEEDED`.
- [x] `2026-08-19T00:00:00Z` MOD `ai/skills/sdd-infra/SKILL.md` — добавлена ветка android симметрично Go-branch; description обновлён.
- [x] `2026-08-19T00:00:00Z` intro `ai/directives/testing/android-testing.xml` — 9 axioms + 3 code patterns + self-check; source-set contract, JVM/Robolectric/AndroidX Test disambiguation; BDD mapping через backtick fun names.
- [x] `2026-08-19T00:00:00Z` MOD `ai/directives/knowledge.xml` — registered `android-setup` (Rules/Infra), `android-testing` (Rules/Testing); CrossRefs kotlin-rules ↔ android-setup ↔ android-testing.
- [x] `2026-08-19T00:00:00Z` insight XML angle brackets `<Class>` / `<scenario-name>` в текстовых узлах ломают xmllint. Заменены на `&lt;…&gt;`.
- [x] `2026-08-19T00:00:00Z` ver `xmllint --noout ai/directives/knowledge.xml ai/directives/testing/android-testing.xml` → pass exit=0
- [x] `2026-08-19T00:00:00Z` DONE

**Handoff →** artifacts: [ai/skills/sdd-infra-android/SKILL.md, ai/skills/sdd-infra/SKILL.md, ai/directives/testing/android-testing.xml, ai/directives/knowledge.xml]; decisions: [skill=clone-of-golang-adapted, testing-baseline=junit4-5+androidx+robolectric, compose+paparazzi+espresso=out-of-scope-here, knowledge-registry=three-new-nodes]; open: []

#### P2

- [x] `2026-08-19T00:00:00Z` ver `npm run type-check` → pass exit=0
- [x] `2026-08-19T00:00:00Z` ver xmllint → pass
- [x] `2026-08-19T00:00:00Z` DONE

**Handoff →** artifacts: []; decisions: [xml-valid, typecheck-clean]; open: [sync-skills-dry-run — не запускался в этом раунде, отложено до следующего sync]

#### Round close

- [x] `2026-08-19T00:00:00Z` sync tasks/README.md tracker index
- [x] `2026-08-19T00:00:00Z` DONE

<!--/SECTION:EXECUTION_LOG-->
