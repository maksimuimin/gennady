# stack: Scope Specification

## scope-type

library

## 1. Vision & Primary Goal

Плагинная система стеков: **один интерфейс верификации для любого стека, одна команда для оператора и агента** — `gennady verify`. Стек (node, golang, дальше — любой) — деталь реализации за общим интерфейсом `StackPlugin`; различия между репозиториями выражаются не разными командами, а конфигом `.gennadyrc` (секция `stack`), который переопределяет и расширяет встроенные плагины.

Проблема, которую решает scope: сейчас верификация прибита к npm (`verify.sh` → `classify-scripts` → `npm run …`), и каждый новый стек порождал бы новую команду (`go-verify`, `rust-verify`, …). Это ровно анти-паттерн «в разных репах — разные команды геннадия». Вместо этого:

- **Единый глагол.** `gennady verify` работает в любом репозитории; плагин выбирается авто-детекцией или конфигом.
- **Единый контракт.** RUN-ALL (все гейты выполняются, отказы накапливаются), SUPPRESS-ON-SUCCESS (успешные гейты молчат), коды выхода `0/1/4/5` — не зависят от стека.
- **Гейты никогда не мутируют** рабочее дерево (никаких `go fmt` / `prettier --write` внутри верификации).
- **FAIL ≠ ENV_FAIL.** Отказ инструмента (паника линтера, недоступный module proxy) — не finding по коду; отчёт явно запрещает агенту «чинить» код в ответ.
- **Конфиг — точка расширения.** Репозиторий с нестандартной инфраструктурой описывает её один раз в `.gennadyrc`, а не учит каждого агента частным командам.

## 2. Functional Requirements

| ID          | Requirement                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-STACK-01 | `StackPlugin` — общий интерфейс стека: `id`, `detect(root)`, `resolveScope(detection, request)`, `planGates(detection, scope, options)`                                                                                        |
| FR-STACK-02 | Реестр встроенных плагинов: `node`, `golang`. Детекция: плагин возвращает `null`, если репозиторий не его; активны все распознавшие                                                                                            |
| FR-STACK-03 | `gennady verify` — стек-агностичная CLI-команда: детекция → скоуп → план → RUN-ALL прогон → отчёт; `--plan` показывает план и диагностику без запуска                                                                          |
| FR-STACK-04 | Секция `stack` в `gennady.config.json` (коммитится) и/или `.gennadyrc` (личный override): `use` (форсировать набор плагинов), per-plugin `skip`, `gates` (override argv/cwd), `extraGates` (добавить свои гейты)               |
| FR-STACK-05 | Порядок применения конфига: план плагина → `gates`-overrides → `skip` → `extraGates`. Переопределённый гейт сохраняет контракт (`outputMeansFailure`)                                                                          |
| FR-STACK-06 | Гейт — чистые данные (`argv`, `cwd`, контракт), исполняется без shell; раннер один на все стеки                                                                                                                                |
| FR-STACK-07 | Классификация отказов: `fail` (код виноват) / `env-fail` (инструмент сломан — по `envFail`-правилам гейта) / `timeout` / `skipped` (с причиной)                                                                                |
| FR-STACK-08 | golang-плагин: гейты `build → vet → fmt → lint → test [→ tidy]`; `-mod=vendor` при вендоринге (кроме `go.work`); конфиг golangci через `-c`, включая имена без точки; скоуп по умолчанию — пакеты, изменённые от базовой ветки |
| FR-STACK-09 | node-плагин: гейты из npm-скриптов `package.json` по классификатору (typecheck / gennady / lint / test / format); watch-скрипты исключаются                                                                                    |
| FR-STACK-10 | `verify.sh` (skill `sdd-execute`) делегирует в `gennady verify`, если тот доступен; легаси npm-путь остаётся фоллбеком                                                                                                         |

## 3. Approved Golden DX Example

```bash
# --- любой репозиторий: план без запуска ---
$ gennady verify --plan

[verify] plan for /repo (stacks: golang)
  module:    gitlab.corp.mail.ru/e-mail-ru/mailapi (go 1.26.2)
  vendored:  true
  config:    /repo/golangci.yml
  scope:     changed — 2 Go file(s) changed vs origin/master

  ⚠️  GOLANGCI_GO_TOO_OLD: golangci-lint built with go1.25.5, module requires go1.26.2 — the linter will panic.
      fix: install a newer golangci-lint, or skip via .gennadyrc: {"stack":{"golang":{"skip":["lint"]}}}

  ▶️  golang:build  go build -mod=vendor ./maillibs/urlshortener
  ▶️  golang:vet    go vet -mod=vendor ./maillibs/urlshortener
  ▶️  golang:fmt    gofmt -l maillibs/urlshortener/shortener.go
  ▶️  golang:lint   golangci-lint run -c /repo/golangci.yml ./maillibs/urlshortener
  ▶️  golang:test   go test -timeout=10m -mod=vendor ./maillibs/urlshortener

# --- happy path: всё прошло — одна строка ---
$ gennady verify
[verify] ALL_GATES_PASS (5/5) — golang: 2 Go file(s) changed vs origin/master

# exit 0

# --- отказ гейта: команда, cwd, exit, вывод ---
$ gennady verify
[verify] ❌ FAIL gate: golang:vet
  command: go vet -mod=vendor ./maillibs/urlshortener
  cwd:     /repo
  exit:    1

--- captured output ---
./shortener.go:42:2: fmt.Printf format %d has arg s of wrong type string
--- end ---

# exit 1

# --- отказ инструмента: агенту явно запрещено «чинить» код ---
$ gennady verify --only=lint
[verify] ❌ ENV_FAIL gate: golang:lint
  note:    the tool itself failed to run — this is NOT a finding about the code.
           Fix the toolchain; do not change source in response to this output.
...
# exit 1

# --- node-репозиторий: та же команда, тот же контракт ---
$ gennady verify
[verify] ALL_GATES_PASS (4/4) — node: npm scripts (type-check, lint:contracts, test, format:check)

# --- явные цели и подмножества гейтов ---
$ gennady verify internal/userapi
$ gennady verify --all --skip=test
$ gennady verify --only=build,vet --json

# --- не распознан ни один стек ---
$ cd /tmp/empty && gennady verify
[verify] NO_STACK_DETECTED: no stack plugin recognized /tmp/empty
  known stacks: node (package.json), golang (go.mod)
  fix: run from a project root, pass --root=<path>, or declare stack.use in .gennadyrc
# exit 5
```

Конфиг-переопределения в `gennady.config.json` репозитория (или личном `.gennadyrc`):

```json
{
  "stack": {
    "use": ["golang"],
    "golang": {
      "skip": ["lint"],
      "testTimeout": "10m",
      "gates": {
        "test": { "argv": ["make", "test"] }
      },
      "extraGates": [
        { "id": "easyjson-drift", "argv": ["make", "check-generated"], "outputMeansFailure": false }
      ]
    }
  }
}
```

## 4. Entity Inventory (Closed-World)

| Name                    | Type         | Purpose                                                                                                                                                             |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StackPlugin`           | Interface    | Общий интерфейс стека: `id`, `detect`, `resolveScope`, `planGates`                                                                                                  |
| `StackId`               | Type         | Идентификатор стека: `'node' \| 'golang'`                                                                                                                           |
| `StackDetection`        | Value Object | Результат детекции: `stack`, `root`, `summary` (строки для `--plan`), `diagnostics`, `details` (per-plugin)                                                         |
| `StackDiagnostic`       | Value Object | Проблема окружения до запуска гейтов: `code`, `message`, `fix`                                                                                                      |
| `ScopeRequest`          | Value Object | Запрос скоупа: `mode` (`files`/`changed`/`all`), `targets`                                                                                                          |
| `StackScope`            | Value Object | Разрешённый скоуп: `mode`, `note`, `details` (per-plugin)                                                                                                           |
| `Gate`                  | Value Object | Планируемый гейт: `id`, `stack`, `label`, `argv`, `cwd`, `outputMeansFailure`, `envFail`, `skipped`                                                                 |
| `GateEnvFailRule`       | Value Object | Правила классификации env-fail: `exitAbove?`, `patterns?`                                                                                                           |
| `GateResult`            | Value Object | Итог гейта: `gate`, `status` (`pass\|fail\|env-fail\|skipped\|timeout`), `exitCode`, `durationMs`, `output`                                                         |
| `VerifyReport`          | Value Object | Итог прогона: `runs`, `diagnostics`, `results`, `passed`, `total`, `ok`                                                                                             |
| `GatePlanOptions`       | Value Object | Опции планирования: `tidy` + `pluginConfig` (срез конфига плагина)                                                                                                  |
| `StackConfig`           | Type         | Секция `stack` из `.gennadyrc`: `use?` + per-plugin `StackPluginConfig`                                                                                             |
| `StackPluginConfig`     | Type         | Per-plugin конфиг: `skip?`, `gates?` (overrides), `extraGates?`, плагин-специфичные ключи                                                                           |
| `GateOverride`          | Type         | Override гейта из конфига: `argv?`, `cwd?`, `outputMeansFailure?`                                                                                                   |
| `ExtraGateSpec`         | Type         | Дополнительный гейт из конфига: `id`, `argv`, `cwd?`, `outputMeansFailure?`                                                                                         |
| `loadStackConfig`       | Function     | Чтение секции `stack` из `.gennadyrc` (cwd → HOME) с валидацией; невалидное → диагностика                                                                           |
| `applyStackConfig`      | Function     | Применение конфига к плану: overrides → skip → extraGates (FR-STACK-05)                                                                                             |
| `detectStacks`          | Function     | Прогон `detect` по реестру с учётом `stack.use`; активные детекции + диагностики; рядом: `pluginConfigOf` (срез конфига плагина), `StackRun` (вклад стека в прогон) |
| `BUILTIN_STACK_PLUGINS` | Constant     | Реестр встроенных плагинов: `[nodePlugin, golangPlugin]`                                                                                                            |
| `runVerify`             | Function     | RUN-ALL исполнение планов всех стеков без shell; таймаут на гейт; классификация статусов                                                                            |
| `formatVerifyReport`    | Function     | Отчёт: диагностики + скипы + отказы (с усечением вывода) + summary-строка при успехе                                                                                |
| `nodePlugin`            | Service      | `StackPlugin` для npm-репозиториев: гейты из классифицированных npm-скриптов                                                                                        |
| `classifyNpmScripts`    | Function     | Эвристика классификации npm-скриптов (порт `classify-scripts.ts`): typecheck/gennady/lint/test/format                                                               |
| `golangPlugin`          | Service      | `StackPlugin` для Go-репозиториев                                                                                                                                   |
| `detectGoProject`       | Function     | Детекция Go-проекта: модули (BFS ≤3, минуя vendor/testdata), `go.work`, вендоринг, конфиг golangci, тулчейн                                                         |
| `resolveGoScope`        | Function     | Скоуп: `files` (явные цели) / `changed` (diff от базовой ветки + staged + untracked) / `all` (`./...`)                                                              |
| `planGoGates`           | Function     | План гейтов Go: build → vet → fmt → lint → test [→ tidy]; недоступное — skip с причиной                                                                             |
| `run`                   | Command      | CLI-команда `gennady verify`: аргументы → конфиг → детекция → скоуп → план → прогон → отчёт                                                                         |

## 5. Module Contracts (DbC)

### 5.1 StackPlugin

- **Runtime Backing:** `real-runtime`
- **Verification Levels:** `unit`

**Contract (DbC):**

- Preconditions:
  - `detect(root)` получает абсолютный существующий путь
- Postconditions:
  - `detect` возвращает `null`, если репозиторий не принадлежит стеку; иначе `StackDetection` с непустым `summary`
  - `planGates` возвращает гейты в детерминированном порядке; неисполнимый гейт представлен `skipped: <reason>`, а не выброшен
- Invariants:
  - Ни одна операция плагина не мутирует рабочее дерево и не запускает процессы, кроме коротких probe-вызовов (`--version`) на этапе `detect`
  - Плагин не знает о конфиге: overrides применяет `applyStackConfig` поверх плана

### 5.2 Gate Runner

- **Runtime Backing:** `real-runtime`
- **Verification Levels:** `unit`

**Contract (DbC):**

- Preconditions:
  - Каждый исполняемый гейт имеет непустой `argv[0]`
- Postconditions:
  - RUN-ALL: выполняются все гейты независимо от отказов предыдущих
  - SUPPRESS-ON-SUCCESS: прошедшие гейты не дают ни строки вывода
  - `outputMeansFailure: true` + exit 0 + непустой stdout → `fail`
  - Совпадение `envFail.patterns` или exit > `envFail.exitAbove` → `env-fail`; отчёт содержит запрет менять код
  - `ok === true` ⇔ ни один исполненный гейт не в статусе `fail`/`env-fail`/`timeout`
- Invariants:
  - Исполнение через `spawnSync(argv)` без shell-интерполяции
  - Вывод отказавшего гейта усечён с явным маркером и командой для полного воспроизведения

### 5.3 Stack Config

- **Runtime Backing:** `real-runtime`
- **Verification Levels:** `unit`

**Contract (DbC):**

- Preconditions:
  - `.gennadyrc` / `gennady.config.json` — JSON; секция `stack` опциональна
- Postconditions:
  - `use` ограничивает реестр; неизвестный id в `use` → диагностика, а не тихое игнорирование
  - Порядок применения: план плагина → `gates`-overrides по id → `skip` → `extraGates`
  - Override без `outputMeansFailure` наследует контракт исходного гейта; extra-гейт по умолчанию `false`
- Invariants:
  - Отсутствие обоих файлов или секции `stack` — валидное состояние (чистая авто-детекция)
  - Битый JSON не роняет verify: диагностика `STACK_CONFIG_INVALID` + продолжение без конфига

### 5.4 Verify Command

- **Runtime Backing:** `real-runtime`
- **Verification Levels:** `unit`, `e2e`

**Contract (DbC):**

- Preconditions:
  - cwd или `--root` указывает в репозиторий
- Postconditions:
  - exit `0` — все гейты прошли; `1` — есть отказ; `4` — неверный вызов (неизвестный гейт в `--only`/`--skip`); `5` — ни один плагин не распознал репозиторий
  - `--plan` не исполняет ни одного гейта
  - `--json` — машиночитаемые `detections`, `plan`, `results`
- Invariants:
  - Явные позиционные цели → `files`; `--all` → `all`; иначе `changed`

## 6. Config Schema (`gennady.config.json` / `.gennadyrc` → `stack`)

```jsonc
{
  "stack": {
    // Форсировать набор плагинов (default: авто-детекция по detect())
    "use": ["node", "golang"],

    "<plugin-id>": {
      // Убрать гейты из плана
      "skip": ["lint"],

      // Переопределить встроенный гейт (id сохраняется, контракт наследуется)
      "gates": {
        "test": { "argv": ["make", "test"], "cwd": "." },
      },

      // Добавить свои гейты (исполняются после встроенных)
      "extraGates": [
        { "id": "codegen-drift", "argv": ["make", "check-generated"], "outputMeansFailure": false },
      ],

      // + плагин-специфичные ключи (golang: testTimeout, lintConfig; node: —)
    },
  },
}
```

## 7. File Structure

```
services/stack/
├── stack.types.ts                     # StackPlugin, Gate, GateResult, StackConfig, ... (closed-world типы)
├── stack-registry.ts                  # BUILTIN_STACK_PLUGINS + detectStacks()
├── stack-config.ts                    # loadStackConfig() + applyStackConfig()
├── gate-runner.ts                     # runVerify() + formatVerifyReport()
└── plugins/
    ├── node/
    │   ├── node-plugin.ts             # nodePlugin: detect + planGates из npm-скриптов
    │   └── classify-npm-scripts.ts    # classifyNpmScripts() — порт эвристики classify-scripts.ts
    └── golang/
        ├── golang-plugin.ts           # golangPlugin: связывает detect/scope/plan
        ├── golang-detect.logic.ts     # detectGoProject()
        ├── golang-scope.logic.ts      # resolveGoScope()
        └── golang-plan.logic.ts       # planGoGates()

cli/cmd/verify/
├── index.ts                           # Entry point (dynamic import)
├── verify.cmd.ts                      # run: аргументы → конфиг → детекция → план → прогон → отчёт
└── help.ts                            # printHelp()
```

**Registration points:**

- `cli/gennady.ts` — help dispatch + command switch
- `cli/cmd/help/help.cmd.ts` — main help listing
- `cli/cmd/README.md` — команды + сценарии
- `README.md` — верхнеуровневая документация
- `ai/skills/sdd-execute/scripts/verify.sh` — делегация в `gennady verify` (FR-STACK-10)

## 8. Decision Log

### D-STACK-001 — Плагины встроены в пакет, не подгружаются из npm

- **Status:** active
- **Why:** Верификация — доверенная поверхность: она исполняет команды. Загрузка стороннего кода плагинов из npm в v1 расширяет поверхность атаки и усложняет воспроизводимость. Точка расширения v1 — конфиг (`gates`/`extraGates`), который выражает 90 % репо-специфики без исполнения чужого кода.
- **Rejected alternatives:** resolve плагинов из `node_modules` по префиксу `gennady-stack-*` (отложено до реального спроса).

### D-STACK-002 — Конфиг: коммитимый `gennady.config.json` + личный override `.gennadyrc`

- **Status:** active
- **Why:** Механизм `.gennadyrc` (JSON, lookup cwd → HOME) уже существует (`GennadyRc`), но `.gennadyrc` в gitignore — его секция `models` может содержать API-ключи, коммитить его нельзя. Репо-шаримая часть поэтому живёт в **`gennady.config.json`** (та же схема, читается тем же `GennadyRc`), а `.gennadyrc` остаётся личным override'ом. Порядок: `.gennadyrc` (cwd) → `gennady.config.json` (cwd) → `.gennadyrc` (HOME); первый файл с секцией `stack` побеждает, без глубокого мерджа. `GennadyRcData` расширяется опциональной секцией; объект без `models` становится валидным (было: ошибка).
- **Rejected alternatives:** un-ignore `.gennadyrc` (риск закоммитить личные ключи), ключи в `package.json` (не существует в Go-репозиториях — ломает симметрию стеков).

### D-STACK-003 — Гейт — данные, раннер — один

- **Status:** active
- **Why:** Пока гейт — это `argv + cwd + контракт`, RUN-ALL/SUPPRESS-ON-SUCCESS/усечение/таймаут/классификация написаны один раз и не могут разъехаться между стеками. Плагины остаются чистыми планировщиками — тестируются без запуска процессов.
- **Rejected alternatives:** плагин исполняет гейты сам (каждый плагин повторно изобретает контракт отчёта).

### D-STACK-004 — env-fail-правила принадлежат гейту, не раннеру

- **Status:** active
- **Why:** «Паника golangci-lint», «exit > 1 у линтера», «Forbidden от module proxy» — знания Go-стека. Раннер применяет декларативные `envFail`-правила из гейта; ни одного стек-специфичного регекспа в общем коде.
- **Rejected alternatives:** глобальный список паттернов в раннере (растёт бесконечно, ложные срабатывания между стеками).

### D-STACK-005 — Мутирующие команды запрещены как гейты

- **Status:** active
- **Why:** `go fmt` / `prettier --write` / `go mod tidy` переписывают дерево — гейт никогда не падает и молча дописывает диф агента посреди фазы. Проверочные формы: `gofmt -l` (+ `outputMeansFailure`), `prettier --check`, `go mod tidy -diff`. Autofix — отдельное явное действие оператора, не верификация.

### D-STACK-006 — node-плагин игнорирует позиционные цели

- **Status:** active
- **Why:** npm-скрипты — репо-уровневые команды; сузить `npm run test` до файла нельзя без знаний о раннере (это делает `testcov`). Честное поведение: node-гейты всегда репо-уровневые, `scope.note` это фиксирует.
- **Risk accepted:** на монорепах node-часть медленнее golang-части; при спросе — интеграция с классификатором целей раннеров.

## 9. Inter-Module Dependencies

- **Depends on:** `shared/backend/rc/rc-config.ts` (расширяется секцией `stack`), `shared/common/parse-args.ts`
- **Provides to:** `cli` (команда `verify`), `ai-skills` (`verify.sh` делегация, skill `sdd-infra-golang`)

## 10. Handoff to Task Scaffolding

- **Tasks:** TSK-95 (библиотека: types, config, registry, runner, plugins node+golang), TSK-96 (CLI `verify` + регистрация + делегация `verify.sh` + документация)
- **Stack dependencies:**
  - Language: `TypeScript` → `ai/directives/coding/typescript-rules.xml`
  - Test framework: `node:test` → `ai/directives/testing/node-test.xml`
- **Open risks & validation needs:**
  - Подгрузка внешних плагинов из npm (D-STACK-001, отложено)
  - node-плагин: скоуп по целям через интеграцию с testcov-классификатором (D-STACK-006, отложено)
  - Стеки rust/python — после появления реальных репозиториев
