# @arbitre/core

## 0.2.1

### Patch Changes

- 96767b5: Update repository metadata for the planned move to github.com/surikaterna/arbitre.

## 0.2.0

### Minor Changes

- Add checkpoint/rollback API for speculative state evaluation
- Self-exclusion in self-joins: when multiple patterns match the same fact type, tokens no longer include duplicate fact instances across bindings
- Inequality join predicates: `$join` supports comparison operators (`$gt`, `$gte`, `$lt`, `$lte`, `$ne`) with equality-first hash index optimization
- Token-binding access in rule actions: `$binding.field` references in `then` expressions resolve to matched fact data from the current token
- Multi-token accumulate: accumulate nodes can be driven by a rule's beta network tokens with per-token expression evaluation

## 0.1.0

### Minor Changes

- 2377a93: Initial release of @arbitre/core — Rete-inspired production rule engine.

  Features:

  - RETE alpha + beta network with multi-fact join matching
  - Match-resolve-act fire cycle with propagation
  - MongoDB-style conditions (via kuery) and pipeline-style actions
  - Salience-based agenda with activation groups and focus stack
  - Truth Maintenance System with fact-level provenance tracking
  - Namespaced state management ($ui, $state, $meta, $contributions)
  - MongoDB update operators ($set, $unset, $inc, $push, $pull, $merge)
  - Expression operators ($sum, $multiply, $cond, $coalesce, etc.)
  - Clock, timer queue, rule expiry, and windowed temporal orchestration
  - Timer queue for scheduled rule activation/deactivation
  - Rule expiry with auto-deactivation
  - Accumulate nodes (sum, count, min, max, avg, collect)
  - Windowed accumulation (time-based sliding window)
  - Cross-type accumulation (join-scoped aggregation)
  - Custom accumulate functions (user-defined aggregation)
  - Fact type registration and working memory CRUD
  - Pattern validation with compile-time error messages
  - Security: prototype pollution prevention, recursion limits
  - Testing utilities (createTestSession, fireWith, assertRuleFired)
  - Debug utilities (explainResult, formatChanges, dumpState)
