# ADR 0001: Kuery expression runtime for rule RHS values

- Status: Accepted for draft implementation
- Date: 2026-09-11
- Issue: Arbitre #23
- Related: Kuery #33/#35/#36 and PR #34; Formbar #90 and PR #91

## Context

Arbitre previously interpreted RHS values recursively with a mutable map of callbacks that received the live scope. That duplicated generic expression behavior, allowed coercive outcomes, treated unknown operators as `null`, and mixed expression extension with Arbitre scheduling. Kuery now owns a bounded JSON `ValueExpression`, immutable profiles, whole-AST compilation, static references, lazy standard operators, and fixed diagnostics.

## Decision

`when` remains a legacy Kuery `TypedQuery`; effects, custom stages, scheduling, transactions, TMS, facts, and the fire cycle remain Arbitre concerns. RHS values for built-in value-taking stages (`$set`, `$inc`, `$push`, and `$merge`) are lowered and compiled once when a rule is registered. `$pull` remains a legacy query predicate because changing it is outside #23. Expression sugar is an Arbitre registration adapter only and does not register profile operators.

The sole built-in profile is immutable `arbitre-v1`, produced with public `standardV1.extend`. It contains all strict standard-v1 operators and namespaced strict extras: `arbitre:min`, `arbitre:max`, `arbitre:avg`, `arbitre:round`, `arbitre:ceil`, `arbitre:floor`, and `arbitre:concat`. A session may provide namespaced Kuery `ExpressionOperatorDefinition` extensions and stricter expression limits. Those trusted callbacks are pure, synchronous, and scope-free. Existing custom stage handlers remain separate trusted, raw, scope-aware callbacks and must use the supplied write callback for tracked changes.

Mongo-inspired RHS shorthand is only an authoring adapter. A one-key `$operator` object lowers recursively; `$path` strings lower to structured references; `$literal` is the explicit escape for JSON data that resembles shorthand. `expression(ast)`/`{$expression: ast}` is the explicit canonical wrapper, avoiding ambiguity with object literals. Objects containing a `$` key without exactly one key are rejected. Kuery canonicalization rejects accessors, unsafe keys, callbacks, promises, non-finite numbers, cycles, exotic objects, and configured bounds.

References identify `root`, registered `namespace`, or declared token `binding` plus a non-empty safe dot path. Shapes are closed and validated at registration. `$foo.bar` selects a declared `foo` token binding first, then a registered `$foo` namespace, and otherwise root path `foo.bar`; `$$foo.bar` forces namespace interpretation and fails when `$foo` is undeclared. Dots always delimit path segments—literal property names containing dots are not addressable. Namespace and binding references cannot target the whole object. Every compiled entry evaluates immediately before its write against the current scope/token, so earlier entries and stages are visible. Missing and denied references remain distinct Kuery diagnostics. Immutable lowering metadata maps generated compile/evaluation paths to the nearest authored sugar path, while explicit `$expression` diagnostics retain canonical paths. Arbitre maps failures to `ARBITER_EXPRESSION_COMPILATION_FAILED` and `ARBITER_EXPRESSION_EVALUATION_FAILED`, without exposing thrown callback or resolver values.

Each compiled rule classifies `conditionReads`, `rhsReads`, `actionWrites`, and `bindingReads`. Built-in actions contribute their statically known potential paths. A custom stage contributes no guessed entry paths and adds the literal `actionWritesUnknown: true` marker; mixed rules retain both their known paths and that marker. Runtime `StateChange` records still contain the exact paths observed through the custom handler's write callback. The alpha index uses only `conditionReads`; RHS and action metadata never causes automatic refiring.

Kuery owns the bounded JSON expression AST, immutable profile, compilation, evaluation, lazy `if`, and expression dependency extraction. Arbitre owns shorthand lowering at registration, live resolution across scope/bindings/namespaces, ordered writes, scheduling, TMS, effects, and custom stages. `$inc` treats only an inspectable absent terminal own property as zero; uninspectable properties, existing non-finite numbers, and every non-number (including `undefined` and `null`) are errors, as are non-finite amounts and results. `$merge` accepts only exact `Object.prototype` or null-prototype data objects with enumerable own data properties and safe string keys. It shallow-copies without invoking getters, preserving the RHS prototype for a missing target and the target prototype otherwise, while materializing writable properties for later stages. Validation failures on trusted plain-data graphs, such as decoded JSON, occur before writes, and commit failures expose only allowlisted operator/rule/path/reason diagnostics.

Hostile or stateful proxies, accessors, exotic objects, and callbacks are outside the supported state boundary and are not sandboxed. Reflection traps and callback code can have external effects for which rollback is impossible. `getState()` and custom-stage scope values are not deeply immutable security views. Checkpoint and provenance cloning preserves cycles, shared references, and null prototypes only within supported containers.

## Migration

| Previous shorthand | Canonical `arbitre-v1` operator | Decision |
| --- | --- | --- |
| `$sum`, `$multiply` | `add`, `mul` | One to 32 arguments lower to deterministic balanced binary trees; strict finite numbers replace null skipping/coercion. |
| `$subtract`, `$divide` | `sub`, `div` | Exactly two finite numbers; zero division is a diagnostic. |
| `$ifNull` | `coalesce` | Lazy missing/null fallback. `$coalesce` is a new strict alias, not a legacy built-in. |
| `$cond` | `if` | Exactly three array arguments; strict boolean condition and lazy selected branch. The legacy object form is not accepted. |
| `$min`, `$max`, `$avg` | namespaced equivalents | One to 32 strict finite numbers. |
| `$round` | `arbitre:round` | Shorthand supplies default places `0`; canonical form takes number and integer places from -15 to 15. |
| `$ceil`, `$floor` | namespaced equivalents | Exactly one finite number. |
| `$concat` | `arbitre:concat` | Strings only; no implicit conversion. |
| `$switch` | nested `if` | One to 32 exact `{case, then}` branches; ordered strict-boolean lazy selection, all static dependencies, and an omitted default of literal `null`. |
| `$toNumber`, `$toString`, `$toBool` | none | Removed. Convert before assertion or add an explicit namespaced pure extension. |
| `$rtime` | `add` | A mandatory signed fixed-unit duration added to structured `$meta.$now`; `d` is exactly 86,400,000 ms. |
| `$after`, `$before` | guarded `gt`, `lt` | Scalar canonical form or a dense singleton tuple alias; comparisons are exclusive. |
| `$elapsed`, `$within` | guarded `gt(sub(now,t),d)`, `lt(sub(now,t),d)` | Exact dense two-item tuples and exclusive comparisons. Missing clock/operands return false, denied references error, present wrong types mismatch, and negative values use direct math. |
| `$literal` | literal node | Bounded JSON only. |
| `$eq`, `$ne`, comparisons, logical, membership, `$exists` | standard-v1 names | Strict, non-coercive Kuery semantics. |
| `$since` | none | No RHS alias exists. |
| `operators.custom` | `expressions.extensions` | Namespaced Kuery definitions; no scope argument and canonical invocation only. |

Temporal sugar requires an explicitly configured clock; there is no implicit `Date.now`. The clock is sampled once per fire before `$meta.$now` is mutated and must return a finite number. Guards may resolve a present operand twice; Arbitre state is stable for the duration of one expression evaluation. Clock/RHS dependencies are introspection metadata only and do not independently schedule a rule.

## Packaging and consequences

Development is temporarily pinned to polished Kuery PR #34 commit `0c0b623adf871d11b437f67535696405a59e6e49`. Bun does not build the git package, so the path-safe preparation script remains in place. It verifies the full pin against the lock and installed tag, rebuilds from clean output directories, validates every exported ESM/CJS/declaration target, and repairs partial or corrupted output rather than trusting a sentinel file. Do not merge or release until compatible Kuery 2.1.0 is published (or a manual Kuery 2.1.0 release is completed); then replace the git pin with that semver, remove `prepare:kuery` and its script, and repeat every gate against a clean packed consumer.

Rejected alternatives are a copied evaluator, deep/private Kuery imports, global mutable registration, dual old/new semantics, eager conditionals, and making RHS reads reactive. This is an intentional breaking pre-1.0 refactor.
