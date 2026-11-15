# Stage 2 — initial verification attempt (historical)

**The failures recorded below were repaired.** For final passing CI,
merged source evidence and remaining release caveats see
[Stage 2 acceptance](17-stage2-acceptance.md).

The imported source snapshot was verified in GitHub Actions. This file is generated
by the verification job. Check the workflow logs/artifacts for full stdout.

Repository: LeviCade/OpenFront-National
Branch: stage2/upstream-import-20261115
Pinned upstream OpenFront commit: 445721718207b6e0f068258cd8ff2eccd13d198e

Protected /proprietary images, fonts and audio were intentionally omitted due
to upstream redistribution restrictions. Some build failures may be related.
No NATIONAL game behavior is implemented by this import.

## Toolchain

Node: v24.15.0
npm: 12.1.0
Upstream source: 445721718207b6e0f068258cd8ff2eccd13d198e
Fork commit: ad1cd7da8d8307f0bd172e8899f48af50576ab8c

## Verification results

| Check            | Result | Detail |
| ---------------- | ------ | ------ |
| Lockfile install | PASS   | Exit 0 |
| Typecheck        | PASS   | Exit 0 |
| Unit tests       | PASS   | Exit 0 |
| Lint             | PASS   | Exit 0 |
| Format           | FAIL   | Exit 1 |
| Production build | FAIL   | Exit 1 |

## Readiness

BASELINE VERIFICATION BLOCKED: 2 check(s) failed. Do not mark Stage 2 complete until repaired and verified. Source files alone do not mean a runnable migration.

## Evidence

Full logs are in the GitHub Actions artifact for this run.
The restrictive /proprietary assets and unexpanded gatekeeper gitlink remain
explicit Stage 2 migration limitations. The Stage 1 product specs are intact.

Stage 3 remains NOT STARTED.
