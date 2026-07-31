# Rejected C6 source-v4-bounded v2 freeze review

This directory preserves the exact five-artifact negative review receipt for
freeze commit `c345e79856e59d98e806d7e6ff12c554a77315bd` (tree
`948419c89c5141bf9c3e7eecd779e33e8e9d9cf1`). The direct review child is
`06044f11ddb0eafcb59be913199afa37fcdcb7bd`.

Fresh reviewer `/root/c6_source_v4_bounded_review_v2` accepted the first seven
required checks and rejected
`direct-review-child-and-strict-activation-still-required`. The frozen
rejected-review workflow test cloned the frozen HEAD, recopied identical
reviewed sources, and then required a non-empty `repaired freeze` commit. Git
returned `nothing to commit`, so the test stopped before proving that a
rejected response blocks activation.

The exact review response is 1,538 bytes with SHA-256
`f00111d63bd3e943380ca441008e0a672b60316eab1782bcdd6877f29274da47`.
The provenance SHA-256 is
`086dca356590b4c274839bc14c8480e13424efa176584d8000e049444d5527ef`.
It records `decision: rejected`, `independentReviewAccepted: false`, and no
freeze, activation, capture, dataset, Codex-run, or claim authority.

The same review independently observed:

- integrated F/R/A/P mutation gate: 1 pass, 0 fail, 26 assertions, 427.62s;
- real snapshot mutation gate: 5 pass, 0 fail, 21 assertions, 105.90s;
- three-seed liveness gate: 1 pass, 0 fail, 6.11s;
- historical v3 preflight gate: 1 pass, 0 fail, 8 assertions, 5.63s;
- reviewed unit slice: 40 pass, 1 deterministic failure.

These files are archived evidence only. They are not the canonical review
paths for a later freeze and cannot be reused by another review chain.
