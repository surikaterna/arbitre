# @arbitre/core

Rete-inspired production rule engine for declarative state governance.

## What's New in 0.2.0

- **Beta network / multi-fact joins** — Rules can match across multiple fact types with join constraints
- **Temporal operators** — Time-based conditions (`since`, `within`, `after`) with clock abstraction
- **Clock abstraction** — Real and virtual clocks for deterministic testing
- **Windowed accumulation** — Aggregate facts over sliding time windows
- **Cross-type accumulation** — Accumulate across multiple fact types in a single rule
- **Custom accumulate functions** — Register domain-specific aggregation logic
- **Pattern validation** — Compile-time validation of fact patterns and join constraints

## Overview

`@arbitre/core` implements a forward-chaining production rule engine based on the RETE algorithm. It evaluates rules against a working memory of state and facts, resolving conflicts via salience and activation groups, and applies changes through a pipeline-style action system.

Key features:

- **Match-Resolve-Act cycle** with configurable limits and conflict resolution
- **Alpha network** for fast single-condition filtering
- **Beta network** for multi-fact joins with bind variables
- **Truth Maintenance System (TMS)** for automatic retraction of derived state
- **Namespaced state** with dot-path access
- **Temporal operators** for time-based reasoning
- **Accumulate nodes** for aggregation patterns

## Quick Start

```typescript
import { createSession } from "@arbitre/core";

const session = createSession({
  rules: [
    {
      name: "high-temp-alert",
      when: { $gt: [{ $path: "sensors.temperature" }, 100] },
      then: [{ $set: { "alerts.overheating": true } }],
      salience: 10,
    },
  ],
  initialState: {
    sensors: { temperature: 105 },
    alerts: { overheating: false },
  },
});

const result = session.fire();
// result.rulesFired === 1
// session.getPath("alerts.overheating") === true
```

### Multi-Fact Joins

```typescript
const session = createSession({
  factTypes: [
    { type: "order", fields: { customerId: "string", total: "number" } },
    { type: "customer", fields: { id: "string", tier: "string" } },
  ],
  rules: [
    {
      name: "vip-large-order",
      patterns: [
        { type: "order", bind: "o", constraints: [{ field: "total", op: "gt", value: 1000 }] },
        { type: "customer", bind: "c", constraints: [{ field: "tier", op: "eq", value: "vip" }] },
      ],
      when: { $eq: [{ $path: "o.customerId" }, { $path: "c.id" }] },
      then: [{ $set: { "notifications.vipLargeOrder": true } }],
    },
  ],
});

session.assertFact("customer", { id: "c1", tier: "vip" });
session.assertFact("order", { customerId: "c1", total: 2500 });
session.fire();
```

### Temporal Operators

```typescript
import { createSession, createVirtualClock } from "@arbitre/core";

const clock = createVirtualClock(0);
const session = createSession({
  clock,
  rules: [
    {
      name: "idle-timeout",
      when: { $since: [{ $path: "user.lastActive" }, 30000] },
      then: [{ $set: { "user.status": "idle" } }],
    },
  ],
  initialState: { user: { lastActive: 0, status: "active" } },
});

clock.advance(31000);
session.tick();
// user.status === "idle"
```

## Architecture

### Match-Resolve-Act Cycle

Each call to `session.fire()` runs a forward-chaining loop:

1. **Match** — Evaluate all rule conditions against current state/facts
2. **Resolve** — Collect activated rules into the agenda, order by salience
3. **Act** — Fire the highest-priority rule, apply `then` stages, repeat

The cycle terminates when no rules activate or limits are reached.

### Alpha Network

Single-condition nodes that filter facts by type and field constraints. Each fact assertion propagates through alpha nodes to determine which rules could potentially match.

### Beta Network

Join nodes that combine partial matches from multiple alpha nodes. Beta nodes maintain a token memory of partial matches and produce complete matches when join constraints are satisfied.

### Agenda

Priority queue of activated rule instances. Conflict resolution strategy:

- **Salience** — Higher salience fires first (default: 0)
- **Activation groups** — Only one rule per group fires per cycle
- **Recency** — Among equal-salience rules, most recently activated wins

### Truth Maintenance System (TMS)

Tracks which rules produced which state changes. When a rule's conditions become false, TMS can automatically retract its contributions:

- `autoRetract: "all"` — Retract all derived state when justification is lost
- `autoRetract: "ui-contributions"` — Retract only UI-namespace contributions

### Namespaces

State is organized as a flat dot-path map. Paths like `"sensors.temperature"` and `"alerts.overheating"` provide logical grouping without nested object complexity.

## API Reference

### Exports

```typescript
// Main entry point
import { createSession } from "@arbitre/core";

// Testing utilities
import { createTestSession, fireWith, assertRuleFired, assertRuleNotFired, assertState } from "@arbitre/core/testing";

// Debug utilities
import { explainResult, formatChanges, dumpState } from "@arbitre/core/debug";
```

### `createSession(config: SessionConfig): RuleSession`

Factory function that compiles rules and returns a session instance.

**SessionConfig:**

| Field | Type | Description |
|-------|------|-------------|
| `rules` | `ProductionRule[]` | Rules to compile into the network |
| `initialState` | `Record<string, unknown>` | Starting state |
| `expressions` | `ArbitreExpressionConfig` | Pure namespaced Kuery profile extensions and stricter bounds |
| `limits` | `SessionLimits` | Cycle/firing limits |
| `tms` | `TmsConfig` | Truth maintenance configuration |
| `errorHandling` | `"strict" \| "lenient"` | Error behavior |
| `factTypes` | `FactTypeDefinition[]` | Fact type schemas |
| `accumulates` | `AccumulateConfig[]` | Accumulation definitions |
| `accumulateFunctions` | `Record<string, CustomAccumulateFunction>` | Custom aggregation functions |
| `clock` | `ArbiterClock` | Clock for temporal operators |
| `autoFireOnFactChange` | `boolean` | Auto-fire on fact assert/retract |

### RuleSession

| Method | Description |
|--------|-------------|
| `registerRule(rule)` | Add a rule at runtime |
| `removeRule(name)` | Remove a rule by name |
| `assert(path, value)` | Assert a state value |
| `retract(path)` | Retract a state value |
| `fire()` | Run the match-resolve-act cycle |
| `subscribe(path, cb)` | Watch a path for changes |
| `update(path, value)` | Assert + fire in one call |
| `getState()` | Get full state snapshot |
| `getPath(path)` | Get value at a dot-path |
| `setFocus(group)` | Set the active activation group |
| `dispose()` | Clean up resources |
| `assertFact(type, data)` | Assert a fact, returns fact ID |
| `retractFact(id)` | Retract a fact by ID |
| `getFacts(type)` | Get all facts of a type |
| `tick(now?)` | Advance temporal evaluation |
| `scheduleRule(name, opts)` | Schedule a rule for future firing |
| `cancelSchedule(name)` | Cancel a scheduled rule |

### ProductionRule

```typescript
interface ProductionRule<TState> {
  name: string;
  when: TypedQuery<TState>;          // kuery expression
  then: ThenStage<TState>[];         // pipeline stages
  else?: ThenStage<TState>[];        // stages when condition is false
  salience?: number;                  // priority (default: 0)
  activationGroup?: string;           // mutex group
  onConflict?: "override" | "warn" | "error";
  enabled?: boolean;
  description?: string;
  expires?: number;                   // TTL in ms
  patterns?: FactPattern[];           // multi-fact patterns
  accumulate?: AccumulateConfig[];    // aggregation configs
}
```

### Action Types (ThenStage operators)

| Operator | Description |
|----------|-------------|
| `$set` | Set values at paths |
| `$unset` | Remove values at paths |
| `$inc` | Increment numeric values |
| `$push` | Append to arrays |
| `$pull` | Remove from arrays |
| `$merge` | Shallow merge objects |

### RHS value expressions

`when` continues to use Kuery query syntax. RHS values use the immutable `arbitre-v1` strict expression profile. Mongo-inspired shorthand is lowered once at registration:

```typescript
import { expression, literal } from "@arbitre/core";

const rule = {
  name: "total",
  when: { enabled: true },
  then: [{ $set: {
    total: { $sum: ["$price", "$tax"] },
    decision: { $cond: ["$approved", "yes", "no"] },
    data: literal({ $sum: [1, 2] }),
    canonical: expression({ kind: "op", op: "add", args: [
      { kind: "literal", value: 1 }, { kind: "literal", value: 2 }
    ] })
  }}]
};
```

Each RHS entry resolves against live state immediately before its write. Declared token bindings take precedence over root paths. Use `session.introspect.getRuleDependencies(name)` to inspect condition reads, RHS reads, action writes, and token-binding reads; only condition reads schedule rules. `actionWrites` contains statically known built-in paths. Rules containing a custom stage also expose `actionWritesUnknown: true`, without treating custom entry keys as writes; runtime state changes remain exact.

Strict shorthand includes arithmetic (`$sum`, `$multiply`, `$subtract`, `$divide`), `$min`/`$max`/`$avg`, rounding, string-only `$concat`, comparisons, boolean logic, membership, `$exists`, `$ifNull`, and lazy `$cond`. Variadic `$sum`/`$multiply` lower to standard `add`/`mul`. `$foo.bar` selects a declared `foo` binding, registered `$foo` namespace, or root path in that order; `$$foo.bar` forces a declared namespace. Dot characters delimit safe segments and are not literal key characters. `$switch`, conversions, and legacy temporal RHS callbacks are deterministic migration errors. See [ADR 0001](./docs/adr/0001-kuery-expression-runtime.md) for the complete migration table and temporary Kuery release blocker.

`$inc` uses zero only for an absent terminal own property and otherwise requires an inspectable finite existing number, finite amount, and finite result. `$merge` shallow-copies exact plain data objects only: `Object.prototype` and null prototypes are accepted, while exotic prototypes, accessors, symbols, non-enumerables, and unsafe keys are rejected before copying. Missing merges preserve the RHS prototype; existing merges preserve the target prototype, and all materialized properties remain writable for later stages. Every mutation copy-on-writes the selected store root and traversed descriptor-safe ordinary/null-prototype objects or arrays before one atomic swap; inherited values are absent, sparse array length and holes are retained, and user-owned containers are never mutation targets. Nested writes through class instances or uninspectable opaque leaves are unsupported, while untouched opaque aliases remain shared. Proxy reflection can have external side effects, but failed preparation leaves Arbitre state, cached views, and provenance unchanged. Checkpoints and provenance snapshots recursively preserve supported null prototypes and cycles. Kuery owns bounded expression compilation/evaluation and lazy expression semantics; Arbitre owns lowering, live resolution, write ordering, scheduling, TMS, effects, and custom stages.

### Condition operators

| Operator | Description |
|----------|-------------|
| `$eq` | Equality |
| `$ne` | Not equal |
| `$gt` / `$gte` | Greater than (or equal) |
| `$lt` / `$lte` | Less than (or equal) |
| `$and` / `$or` / `$not` | Logical combinators |
| `$in` / `$nin` | Set membership |
| `$exists` | Path existence check |
| `$regex` | Regular expression match |

### Temporal behavior

Clock injection (`$meta.$now`), `tick`, schedules, rule expiry, and windowed accumulation are unchanged. Scope-aware temporal RHS callbacks were part of the removed custom expression contract; use strict comparisons against `$$meta.$now` or precompute a value before assertion.

### Error Codes

| Code | Description |
|------|-------------|
| `ARBITER_RULE_COMPILATION_FAILED` | Rule could not be compiled |
| `ARBITER_INVALID_PATH` | Invalid dot-path |
| `ARBITER_INVALID_OPERATOR` | Unknown operator in then/when |
| `ARBITER_CYCLE_LIMIT_EXCEEDED` | Max cycles reached |
| `ARBITER_FIRING_LIMIT_EXCEEDED` | Max firings reached |
| `ARBITER_WRITE_CONFLICT` | Multiple rules writing same path |
| `ARBITER_TMS_RETRACT_FAILED` | TMS retraction error |
| `ARBITER_INVALID_NAMESPACE` | Invalid namespace in path |
| `ARBITER_SESSION_DISPOSED` | Operation on disposed session |
| `ARBITER_PROTOTYPE_POLLUTION` | Prototype pollution attempt blocked |
| `ARBITER_EXPRESSION_COMPILATION_FAILED` | RHS expression failed bounded registration-time compilation |
| `ARBITER_EXPRESSION_EVALUATION_FAILED` | RHS expression evaluation error |
| `ARBITER_RULE_NOT_FOUND` | Referenced rule does not exist |
| `ARBITER_INVALID_CLOCK_OPERATION` | Invalid clock operation |

## Testing Utilities

Import from `@arbitre/core/testing`:

```typescript
import { createTestSession, fireWith, assertRuleFired, assertRuleNotFired, assertState } from "@arbitre/core/testing";

// Quick session for tests
const session = createTestSession(rules, { counter: 0 });

// Fire rules and get result in one call
const result = fireWith(rules, { temperature: 150 });

// Assertions
assertRuleFired(result, "high-temp-alert");
assertRuleNotFired(result, "low-temp-alert");
assertState(session, "counter", 1);
```

## Debug Utilities

Import from `@arbitre/core/debug`:

```typescript
import { explainResult, formatChanges, dumpState } from "@arbitre/core/debug";

const result = session.fire();

console.log(explainResult(result));
// Fired 2 rules in 1 cycles
// Changes:
//   alerts.overheating: false → true (by high-temp-alert)
// Warnings: none

console.log(formatChanges(result));
console.log(dumpState(session));
```

## Performance

The RETE network provides efficient incremental evaluation:

- **Alpha network** — O(1) per fact type lookup, linear in constraints per node
- **Beta network** — Incremental join; only new tokens propagate
- **State changes** — Only affected rules re-evaluate (no full re-scan)
- **Cycle limits** — Configurable guards prevent runaway inference

Typical performance for rule sets under 100 rules with moderate fact counts:
- Single-fact evaluation: < 1ms
- Multi-fact joins (10 facts × 10 facts): < 5ms
- Full cycle with TMS: < 10ms

## Rule Builder

For programmatic rule construction, use the `defineRule` fluent builder:

```typescript
import { defineRule } from "@arbitre/core";

const rule = defineRule("high-value-order")
  .when({ $gt: [{ $path: "order.total" }, 1000] })
  .then([{ $set: { "flags.highValue": true } }])
  .salience(5)
  .description("Flag orders over $1000")
  .build();
```

## Observability

### Lifecycle Hooks

```typescript
import { createSession } from "@arbitre/core";
import type { SessionHooks } from "@arbitre/core";

const hooks: SessionHooks = {
  onRuleActivated: (e) => console.log(`Activated: ${e.ruleName}`),
  onRuleFired: (e) => console.log(`Fired: ${e.ruleName}`),
  onRuleDeactivated: (e) => console.log(`Deactivated: ${e.ruleName}`),
  onFactAsserted: (e) => console.log(`Fact+: ${e.factType}#${e.factId}`),
  onFactRetracted: (e) => console.log(`Fact-: ${e.factType}#${e.factId}`),
  onCycleStart: (e) => console.log(`Cycle ${e.cycleNumber} start`),
  onCycleEnd: (e) => console.log(`Cycle ${e.cycleNumber} end`),
};

const session = createSession({ rules, hooks });
```

### Custom Logger

```typescript
import type { ArbiterLogger } from "@arbitre/core";

const logger: ArbiterLogger = {
  debug: (msg, ctx) => myLogger.debug(msg, ctx),
  info: (msg, ctx) => myLogger.info(msg, ctx),
  warn: (msg, ctx) => myLogger.warn(msg, ctx),
  error: (msg, ctx) => myLogger.error(msg, ctx),
};

const session = createSession({ rules, logger });
```

### Introspection

```typescript
const session = createSession({ rules, initialState });
session.fire();

const i = session.introspect;
console.log(i.getRegisteredRules());  // ["rule-a", "rule-b"]
console.log(i.getActiveRules());      // ["rule-a"]
console.log(i.getAgendaEntries());    // [] (empty after fire)
console.log(i.getFactCounts());       // { order: 3 }
console.log(i.getMetrics());          // { totalRulesFired: 2, ... }
```

## Dependencies

| Dependency | Role |
|------------|------|
| `kuery` | Expression language for rule conditions (`when` clauses) |

## License

MIT
