---
name: sdd-infra-android
description: Bootstrap or evolve the Android infrastructure scope of an SDD project — Gradle module layout, verification gates via the stack plugin system (gennady verify), gennady.yaml overrides, AGP × JDK toolchain diagnostics. Use when the scope is an Android app or library (canonical Gradle layout — `settings.gradle{.kts}` + `gradlew` + wrapper), especially brownfield multi-module AGP 8+ projects where `./gradlew check` is too coarse to be a per-phase gate. Also use to diagnose why Android gates fail or lie.
license: MIT
compatibility: opencode
---

<SddInfraAndroid>

Android specialisation of `sdd-infra`. Scope-type is fixed: `infrastructure`; language is fixed: `kotlin` (Android platform).

The deterministic half of this skill is the stack plugin system — **one verb for every stack**: `gennady verify`. The android plugin carries the Gradle knowledge; the repo's deviations live in `gennady.yaml` (section `stack.android`; personal `.gennadyrc` files deep-merge on top), never in ad-hoc per-repo commands. Read `ai/directives/infra/android-setup.xml` for the reasoning behind every rule below. The Kotlin source cascade layered on top of infra: `ai/directives/coding/kotlin-rules.xml` (language baseline) → `ai/directives/coding/kotlin-coroutines.xml` (activate for files touching `suspend` / `Flow`) → `ai/directives/coding/compose-rules.xml` (activate for `@Composable` files).

## 1. Orient before designing

Never propose Android tooling for a repository you have not inspected. Run:

```bash
npx gennady verify --plan
```

This prints, without executing anything:

- which stacks were detected (a repo can be android + node at once — canonical mobile monorepo with `android/` subdir uses `--root=android`)
- AGP-holder module (`com.android.application` / `com.android.library` — direct or via `libs.plugins.<alias>` from `libs.versions.toml`), and how it was resolved (D-STACK-018)
- AGP version from `gradle/libs.versions.toml`
- diagnostic `ANDROID_MODULE_LIMIT_EXCEEDED` — if 32 include-modules were scanned and AGP is in the 33+, the fix is `stack.use: [android]` + `--root=<путь-к-держателю-AGP>`
- the exact argv of every gate that would run (`./gradlew assembleDebug`, `./gradlew lintDebug`, `./gradlew testDebugUnitTest`, plus optional `ktlintCheck` / `detekt` / `spotlessCheck` when the corresponding Gradle plugin is applied)

Machine-readable form for a subagent: `npx gennady verify --plan --json`.

## 2. Read the diagnostics honestly

| Diagnostic (source)                                       | Meaning                                                                              | Correct response                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `ANDROID_MODULE_LIMIT_EXCEEDED` (`gennady verify --plan`) | 32 include-modules from `settings.gradle{.kts}` scanned; AGP not found in any        | `stack.use: [android]` + `--root=<AGP-holder-module-path>`, or narrow `include(...)` in settings                             |
| No stack detected on Android repo                         | One of five wrapper files missing (`gradlew`, `gradle-wrapper.jar` etc., D-STACK-014) | Restore the wrapper (`gradle wrapper`), or force via `stack.use: [android]` — but gates will ENV_FAIL without `./gradlew`    |
| env-fail: `Unsupported class file major version N`        | JDK bytecode incompatible with AGP-required JDK                                       | Install a compatible JDK, or add a `kotlin { jvmToolchain(N) }` / `java { toolchain { ... } }` block. **Do NOT edit source.** |
| env-fail: `Gradle 8.x requires Java 17 to run`            | System JDK below Gradle floor                                                        | Upgrade JDK, or pin Gradle in `gradle/wrapper/gradle-wrapper.properties`                                                     |
| env-fail: `Could not resolve <dep>`                       | Maven/Gradle registry blocked (corp proxy, DNS, TLS)                                 | Unblock proxy in `~/.gradle/gradle.properties` (`systemProp.http.proxyHost=…`); or `stack.android.skipGates: [lint]`         |
| env-fail: `Received status code 4\d\d`                    | Registry auth / rate-limit / forbidden                                               | Fix credentials or proxy — never edit source                                                                                 |
| env-fail: `Gradle build daemon disappeared`               | Gradle daemon JVM crash / OOM                                                        | Increase `-Xmx` in `gradle.properties` (`org.gradle.jvmargs=-Xmx4g`); check dmesg for OOM-killer                              |
| env-fail: `KotlinFrontEndException` on `assemble`/`lint`  | Kotlin compiler panic (compiler bug, not source)                                     | Upgrade Kotlin toolchain; report to JetBrains. **Do NOT edit source in response.**                                           |
| `VIOLATION` on a gate                                     | Gate mutated the sandbox replica — contract §D-STACK-005                             | Move the mutation to a fixer (post-v1); or mark the gate `sandbox: true` if drift **is** the verdict                         |

An agent that "fixes" code in response to `ENV_FAIL` produces confident, wrong diffs. Report it to the operator and stop rather than guessing.

## 3. Wire the gate into the SDD loop

The per-phase gate, run from the module root:

```bash
npx gennady verify
```

Android is repo-level scope (D-STACK-006, symmetric to node): Gradle-tasks aren't file-narrowable without runner knowledge (future `testcov` facet). `--plan` shows the full argv; `--only` narrows deliberately:

```bash
npx gennady verify --all                            # every active stack
npx gennady verify --only=android:assemble          # single gate
npx gennady verify --only=android:lint,android:test # multi-gate
npx gennady verify --skip=lint                      # documented, visible skip
npx gennady verify --stack=android                  # one-shot stack.use
npx gennady verify --root=android                   # canonical mobile monorepo
```

Contract (all stacks): **RUN-ALL** · **SUPPRESS-ON-SUCCESS** · exit `0` all pass, `1` gate failed, `4` bad invocation/config, `5` no stack detected.

Every gate runs in an ephemeral working-tree replica (one per verify run) — the real tree is physically untouched. The android plugin declares `sandboxLinks: ['.gradle', '.kotlin']` (D-STACK-016) so config-cache and K2 incremental daemon metadata survive between runs; `build/` is deliberately **not** linked — that is compiled state, freshness is the point. Cold-clean assemble on a mid-size project is 5–15 min; warm daemon with linked caches, seconds. Do not add `build/` to `sandboxLinks` — it re-enables the `holds-stale-artifacts` foot-gun.

Mutating Gradle tasks are forbidden as gates (D-STACK-005): `ktlintFormat`, `spotlessApply`, `./gradlew --refresh-dependencies --write-locks` — these rewrite the tree, a gate is supposed to observe. Their place is in the `fix` facet (post-v1). The verify-plan surfaces only checking forms: `ktlintCheck`, `detekt`, `spotlessCheck`.

`connectedAndroidTest` is deliberately **not** in the base plan (D-STACK-015): it requires an emulator/device, orthogonal to the SDD execute→verify loop. Declare it as `extraGates` in the repo `gennady.yaml` if needed for a specific pipeline.

## 4. Encode repo deviations in `gennady.yaml`, not in prose

When a repo verifies differently (custom Gradle tasks, Paparazzi drift check, proxy config), declare it **once, in the repo**:

```yaml
stack:
  android:
    skipGates: [lint] # lint config not yet migrated to AGP 8+ — restore after refactor
    overrideGates:
      test: { timeout: 20m } # multi-module unit test suite runs long
      assemble:
        env:
          GRADLE_OPTS: "-Xmx4g -Dorg.gradle.daemon=false" # CI-only override
    extraGates:
      - { id: paparazzi, argv: [./gradlew, verifyPaparazziDebug], timeout: 10m }
      - { id: baseline-profile, argv: [./gradlew, generateBaselineProfile], timeout: 15m }
```

Application order: plugin plan → `overrideGates` → `skipGates` → `extraGates`. Personal `.gennadyrc` files deep-merge on top (per-key winner shown in `--plan`). An extra gate must be non-mutating like every other gate — Paparazzi's `verify*` variant checks, `record*` mutates; use `verify*`.

## 5. Distinguish FAIL from ENV_FAIL — this is the important one

- **`FAIL`** — Gradle ran, the task ran, and reported a problem in the code (Kotlin type error, lint warning at error level, failing test assertion). Fix the code.
- **`ENV_FAIL`** — the toolchain could not run: JDK/AGP skew, Gradle daemon crashed, Maven proxy blocked, Kotlin compiler panic (on `assemble`/`lint` — not `test`, where compiler panic is a compiler bug regardless). **The code is not implicated.** Do not edit sources in response; fix the environment or skip the gate explicitly.

The predicate set is nailed down in stack.spec.md §D-STACK-019; the runner classifies via output-regex predicates on the gate, not by exit-code alone (Gradle's exit-code discipline is not fine-grained enough).

## 6. Rules that survive contact with real Android repositories

Full reasoning in `ai/directives/infra/android-setup.xml`; the short form:

1. **One verb, every stack.** Differences go into `gennady.yaml`, not into new commands.
2. **Gates never mutate.** `ktlintCheck` / `spotlessCheck` / `lintDebug`, never `ktlintFormat` / `spotlessApply`.
3. **Scope is repo-level** (Gradle-task, D-STACK-006). No file narrowing in v1.
4. **Base plan is granular** (D-STACK-015): `assembleDebug` → `lintDebug` → `testDebugUnitTest`, not `./gradlew check`. `--only=android:lint` works; assemble failure short-circuits lint/test on Gradle's own dependency graph.
5. **`sandboxLinks: ['.gradle', '.kotlin']` is non-negotiable** (D-STACK-016). Cold Gradle is unusable for iteration.
6. **Base plan excludes `connectedAndroidTest`** — device tests are `extraGates`, not core loop.
7. **`ktlintCheck` / `detekt` / `spotlessCheck` are auto-skipped** when the Gradle plugin isn't applied (`skipped: 'плагин <id> не подключён'`) — same posture as golang's `generate` skipping when no `//go:generate` directives.
8. **Bound everything** — mandatory per-gate timeout: assemble 10m, lint 5m, test 10m, optional linters 5m each. Long test suites go via `overrideGates.test.timeout`.

## 7. Designing a new Android infra scope

When the operator wants tooling *designed* rather than merely run:

1. **Extract intent.** Confirm scope-type=`infrastructure`, language=`kotlin` (Android platform). Resolve the scope name (e.g. `infra-android`).
2. **Load & activate.** Read in full: `~/Developer/gennady/ai/directives/sdd/discovery.directive.xml`, then `~/Developer/gennady/ai/directives/infra/android-setup.xml`, then `~/Developer/gennady/ai/directives/coding/kotlin-rules.xml` (Kotlin source baseline). If the scope will touch `suspend` / `Flow` / coroutine builders, also load `~/Developer/gennady/ai/directives/coding/kotlin-coroutines.xml`. If the scope will emit Compose UI, also load `~/Developer/gennady/ai/directives/coding/compose-rules.xml`.
   Announce: `🔒 DIRECTIVE ACTIVATED: SddDiscovery | infrastructure | android`
3. **Ground every requirement in observed state** — the `--plan --json` output above, not assumptions about how Android projects usually look (single-module vs multi-module AGP 8+ is a real fork, §3.6 in stack.spec.md).
4. **Apply.** Follow the discovery Execution_Plan end-to-end. Every proposed gate must be expressible as a `gennady verify` invocation or a `gennady.yaml` entry — or justified as to why it is not.

</SddInfraAndroid>
