---
"@arbitre/core": minor
---

Replace the pre-1.0 rule RHS evaluator and scope-aware custom expression callbacks with bounded Kuery `arbitre-v1` expressions, registration-time shorthand compilation (including lazy `$switch`, fixed-unit `$rtime`, and guarded temporal predicates), structured live references, authored sugar diagnostics, validation-before-write `$inc`/descriptor-safe `$merge` behavior for trusted plain-data graphs, redacted commit failures, and classified dependencies with unknown custom-stage writes marked explicitly. Hostile traps and trusted custom callback effects are outside the rollback boundary. This is an intentional breaking pre-1.0 refactor; see ADR 0001 for migration details.
