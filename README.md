# Arbitre

Rete-inspired production rule engine for declarative state governance.

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@arbitre/core`](./packages/core) | Rule engine with RETE network, TMS, temporal operators, and multi-fact joins | 0.1.0 |

## Quick Start

```bash
bun install
bun run build
bun test
```

## Development

```bash
# Build all packages
bun run build

# Run tests
bun run test

# Lint
bun run lint

# Lint + autofix
bun run lint:fix
```

## Expression boundary

Kuery owns bounded JSON expression ASTs, profiles, compilation, evaluation, lazy conditionals, and expression dependency extraction. Arbitre lowers RHS shorthand at registration and owns live scope/binding/namespace resolution, ordered writes, scheduling, TMS, effects, and custom stages. Strict `$inc` and descriptor-safe plain-object `$merge` semantics, dependency introspection (including `actionWritesUnknown` for custom stages), and the temporary Kuery release blocker are documented in [ADR 0001](./packages/core/docs/adr/0001-kuery-expression-runtime.md).

## License

MIT
