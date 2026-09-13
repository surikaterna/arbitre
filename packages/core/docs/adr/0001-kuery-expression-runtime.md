# ADR 0001: Kuery expression runtime for rule RHS values

- Status: Accepted for draft implementation
- Date: 2026-09-11
- Issue: Arbitre #23
- Related: Kuery #33/#35/#36 and PR #34; Formbar #90 and PR #91

## Context

Arbitre previously interpreted RHS values recursively with a mutable map of callbacks that received the live scope. That duplicated generic expression behavior, allowed coercive outcomes, treated unknown operators as `null`, and mixed expression extension with Arbitre scheduling. Kuery now owns a bounded JSON `ValueExpression`, immutable profiles, whole-AST compilation, static references, lazy standard operators, and fixed diagnostics.

## Decision

`when` remains a legacy Kuery `TypedQuery`; effects, custom stages, scheduling, transactions, TMS, facts, and the fire cycle remain Arbitre concerns. RHS values for built-in value-taking stages (`$set`, `$inc`, `$push`, and `$merge`) are lowered and compiled once when a rule is registered. `$pull` remains a legacy query predicate because changing it is outside #23.

The sole built-in profile is immutable `arbitre-v1`, produced with public `standardV1.extend`. It contains all strict standard-v1 operators and namespaced strict extras: `arbitre:min`, `arbitre:max`, `arbitre:avg`, `arbitre:round`, `arbitre:ceil`, `arbitre:floor`, and `arbitre:concat`. A session may provide namespaced Kuery `ExpressionOperatorDefinition` extensions and stricter expression limits. Those trusted callbacks are pure, synchronous, and scope-free. Existing custom stage handlers remain separate and may receive scope.

Mongo-inspired RHS shorthand is only an authoring adapter. A one-key `$operator` object lowers recursively; `$path` strings lower to structured references; `$literal` is the explicit escape for JSON data that resembles shorthand. `expression(ast)`/`{$expression: ast}` is the explicit canonical wrapper, avoiding ambiguity with object literals. Objects containing a `$` key without exactly one key are rejected. Kuery canonicalization rejects accessors, unsafe keys, callbacks, promises, non-finite numbers, cycles, exotic objects, and configured bounds.

References identify `root`, registered `namespace`, or declared token `binding` plus a non-empty safe dot path. Shapes are closed and validated at registration. `$foo.bar` selects a declared `foo` token binding first, then a registered `$foo` namespace, and otherwise root path `foo.bar`; `$$foo.bar` forces namespace interpretation and fails when `$foo` is undeclared. Dots always delimit path segments—literal property names containing dots are not addressable. Namespace and binding references cannot target the whole object. Every compiled entry evaluates immediately before its write against the current scope/token, so earlier entries and stages are visible. Missing and denied references remain distinct Kuery diagnostics. Arbitre maps compile and evaluation failures to `ARBITER_EXPRESSION_COMPILATION_FAILED` and `ARBITER_EXPRESSION_EVALUATION_FAILED`, without exposing thrown callback or resolver values.

Each compiled rule classifies `conditionReads`, `rhsReads`, `actionWrites`, and `bindingReads`. The alpha index uses only `conditionReads`; RHS metadata never causes automatic refiring.

## Migration

| Previous shorthand | Canonical `arbitre-v1` operator | Decision |
| --- | --- | --- |
| `$sum`, `$multiply` | `add`, `mul` | One to 32 arguments lower to deterministic balanced binary trees; strict finite numbers replace null skipping/coercion. |
| `$subtract`, `$divide` | `sub`, `div` | Exactly two finite numbers; zero division is a diagnostic. |
| `$ifNull` / `$coalesce` | `coalesce` | Lazy missing/null fallback. |
| `$cond` | `if` | Exactly three arguments; strict boolean condition and lazy selected branch. |
| `$min`, `$max`, `$avg` | namespaced equivalents | One to 32 strict finite numbers. |
| `$round` | `arbitre:round` | Shorthand supplies default places `0`; canonical form takes number and integer places from -15 to 15. |
| `$ceil`, `$floor` | namespaced equivalents | Exactly one finite number. |
| `$concat` | `arbitre:concat` | Strings only; no implicit conversion. |
| `$switch` | none | Deterministic registration-time migration error. Use nested `$cond`/`if`. |
| `$toNumber`, `$toString`, `$toBool` | none | Removed. Convert before assertion or add an explicit namespaced pure extension. |
| `$elapsed`, `$within`, `$after`, `$before` | none | Removed scope-aware RHS callbacks. Compare explicit `$$meta.$now` references with strict standard operators. Clock, tick, schedules, expiry, and windows remain. |
| `$literal` | literal node | Bounded JSON only. |
| `$eq`, `$ne`, comparisons, logical, membership, `$exists` | standard-v1 names | Strict, non-coercive Kuery semantics. |
| `operators.custom` | `expressions.extensions` | Namespaced Kuery definitions; no scope argument. |

## Packaging and consequences

Development is temporarily pinned to Kuery PR #34 commit `e446db3bb55444390945741dd75bfd351a604fe2`. Bun does not build the git package, so a path-safe preparation script builds its public exports. The Arbitre PR must remain draft and cannot merge or release until a compatible Kuery semver is published, the git pin/workaround is removed, and all gates are repeated.

Rejected alternatives are a copied evaluator, deep/private Kuery imports, global mutable registration, dual old/new semantics, eager conditionals, and making RHS reads reactive. This is an intentional breaking pre-1.0 refactor.
