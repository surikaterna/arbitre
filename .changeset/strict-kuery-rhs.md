---
"@arbitre/core": minor
---

Replace the pre-1.0 rule RHS evaluator and scope-aware custom expression callbacks with bounded Kuery `arbitre-v1` expressions, registration-time shorthand compilation, structured live references, descriptor-only copy-on-write transactions with strict atomic `$inc`/`$merge` writes, and classified dependencies with unknown custom-stage writes marked explicitly. This is an intentional breaking pre-1.0 refactor; see ADR 0001 for migration details.
