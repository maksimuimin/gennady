# Coding rules

Language-specific rules for HOW to write code: syntax preferences, naming, error handling, comment style, language idioms.

Distinct from:

- `runtimes/` — runtime SETUP (Node version, package manager).
- `quality/` — cross-language quality (binary lint severity, formatting delegation).
- `architecture/` — composition patterns.

## Currently available

- [`typescript-rules.xml`](typescript-rules.xml) — TypeScript writing conventions.
- [`svelte5-runes.xml`](svelte5-runes.xml) — Svelte 5 runes: $state, $derived, $effect, $props, template syntax. **Inherits typescript-rules.**
- [`sveltekit-rules.xml`](sveltekit-rules.xml) — SvelteKit fullstack: routing, load, form actions, hooks, $app modules. **Inherits svelte5-runes + typescript-rules.**
- [`kotlin-rules.xml`](kotlin-rules.xml) — Kotlin baseline (Android + Kotlin/JVM subset): null-safety, immutability, scope-function intent, sealed exhaustiveness, KDoc contract, structural anchors.
- [`kotlin-coroutines.xml`](kotlin-coroutines.xml) — `kotlinx.coroutines` + `kotlinx.coroutines.flow`: structured concurrency, dispatcher discipline + injection, scope lifecycle ownership, timeouts, `Mutex`, `Flow` / `SharedFlow` / `StateFlow`, coroutine testing. **Inherits kotlin-rules.**
- [`compose-rules.xml`](compose-rules.xml) — Jetpack Compose: composable purity, state hoisting, `remember`, side-effect entries, recomposition stability, `Modifier` chain, `CompositionLocal`, `LazyColumn` keys, `@Preview`, Compose UI testing. **Inherits kotlin-coroutines + kotlin-rules.**

## Kotlin cascade

```
kotlin-rules          (language baseline; every .kt / .kts activates it)
   └─ kotlin-coroutines   (activate when file imports kotlinx.coroutines.* or uses suspend / Flow)
        └─ compose-rules   (activate when file contains @Composable)
```

A composable file loads all three. A pure-sync Kotlin file loads only `kotlin-rules`. A `ViewModel` with a `StateFlow` loads `kotlin-rules` + `kotlin-coroutines` — but NOT `compose-rules` (no `@Composable` there).

## Planned

- `react-rules.xml` — React component patterns, hooks discipline, JSX conventions.
- `go-rules.xml` — Go idioms, error handling, package layout.
- `python-rules.xml` — Python style (PEP 8 + project-specific tightening), type hints, dataclasses vs Pydantic.
- `rust-rules.xml` — Rust idioms, error handling (`Result`, `?` operator), lifetimes & borrowing patterns.
- `css-rules.xml` — CSS naming (BEM / utility-first), specificity discipline.
- Kotlin layered rules (post-baseline): `kotlin-hilt.xml` (Hilt DI), `kotlin-kmp.xml` (`expect` / `actual`), `kotlin-room.xml` (DB DAO / entity patterns).
