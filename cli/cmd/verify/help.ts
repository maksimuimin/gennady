// @file: verify command help output
// @consumers: verify.cmd.ts, gennady.ts
// @tasks: TSK-96

/**
 * @purpose Print CLI help for the verify command.
 */
export function printHelp(): void {
  console.info('gennady verify — stack-agnostic verification gates (one command for every stack)');
  console.info('');
  console.info('Usage:');
  console.info('  npx gennady verify [path...] [options]');
  console.info('');
  console.info('Stacks (auto-detected; both can be active in one repo):');
  console.info(
    '  node     package.json — gates from classified npm scripts (typecheck/lint/test/format)'
  );
  console.info(
    '  golang   go.mod — build, vet, gofmt -l, golangci-lint, go test; changed-package scoping'
  );
  console.info('');
  console.info('Scope (default: changes vs the base branch):');
  console.info('  <path...>             Files or directories (golang narrows to their packages)');
  console.info('  --all                 Whole repository — slow on monorepos');
  console.info('  --changed             Changed vs origin/master|main (default)');
  console.info('');
  console.info('Options:');
  console.info('  --plan, --dry-run     Print detection, diagnostics and the plan; run nothing');
  console.info('  --json                Machine-readable detection + plan + results');
  console.info('  --only=<a,b>          Run only these gates (ids from the plan)');
  console.info('  --skip=<a,b>          Drop these gates from the plan');
  console.info('  --stack=<id>          Restrict to one stack plugin (node | golang)');
  console.info('  --tidy                golang: add the go.mod drift gate (off by default — slow)');
  console.info('  --root=<path>         Repository root (default: cwd)');
  console.info('  --timeout=<seconds>   Per-gate wall-clock budget (default: 900)');
  console.info('  --help, -h            Show this help');
  console.info('');
  console.info(
    'Repo config — gennady.config.json (committable) or .gennadyrc (personal override), section "stack":'
  );
  console.info('  {');
  console.info('    "stack": {');
  console.info('      "use": ["golang"],');
  console.info('      "golang": {');
  console.info('        "skip": ["lint"],');
  console.info('        "testTimeout": "10m",');
  console.info('        "gates": { "test": { "argv": ["make", "test"] } },');
  console.info(
    '        "extraGates": [{ "id": "codegen-drift", "argv": ["make", "check-generated"] }]'
  );
  console.info('      }');
  console.info('    }');
  console.info('  }');
  console.info('');
  console.info('Contract:');
  console.info('  RUN-ALL             every gate runs; failures accumulate in one report');
  console.info('  SUPPRESS-ON-SUCCESS passing gates print nothing');
  console.info('  gates never mutate  gofmt -l / go mod tidy -diff, never go fmt / tidy');
  console.info('  FAIL vs ENV_FAIL    a broken tool (panic, blocked proxy) is not a code finding');
  console.info('  exit 0 all pass · 1 gate failed · 4 bad invocation · 5 no stack detected');
  console.info('');
  console.info('Examples:');
  console.info('  npx gennady verify --plan');
  console.info('  npx gennady verify internal/userapi');
  console.info('  npx gennady verify --only=build,vet');
  console.info('  npx gennady verify --all --skip=test --json');
  console.info('  npx gennady verify --stack=golang --tidy');
}
