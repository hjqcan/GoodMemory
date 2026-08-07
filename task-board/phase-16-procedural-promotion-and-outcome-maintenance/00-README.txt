Phase 16 Subtasks
=================

v0.7.3 correction (2026-08-06): this folder is historical execution
provenance. The shipped touch/reinforce ranking loop was removed in v0.7.3;
retrieval exposure no longer mutates or ranks memory. See ADR-004. Existing
Phase 16 status and evidence remain unchanged below.

Purpose
-------
This folder decomposes procedural promotion and outcome-aware maintenance into concrete execution slices.

Use it together with:

- task-board/17-phase-16-procedural-promotion-and-outcome-maintenance.txt


Execution Order
---------------
1. 04-recall-scoring-with-outcome-metrics.txt
2. 02-outcome-mutation-helpers.txt
3. 03-verify-driven-demotion-and-correction-repair.txt
4. 01-validated-pattern-compiler.txt
5. 05-dream-orchestration-expansion.txt
6. 06-regression-and-eval-slices.txt

Execution Notes
---------------
- Current code already emits governed procedural proposals, so the lowest-risk next slice is to make outcome signals visible in recall before adding new promotion mutations.
- Score attribution should land before touch/reinforce helpers so the first rollout remains explainable in traces and CLI output.
- `[DONE]` here means the implementation slice is complete and accepted.
- Phase 16 currently still keeps the eval/regression slice open until broader result metrics are in place.


Status Rule
-----------
Use:

- [TODO]
- [WIP]
- [DONE]
