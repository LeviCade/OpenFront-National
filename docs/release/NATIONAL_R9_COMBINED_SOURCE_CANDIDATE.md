# Round Nine combined development candidate

**Development source only. Not a public release.**

- Base integration: `42e2b5d0a6372737b78178e5be49da7b76383d0a`.
- Six-owner source assembly: `ac27a145a99eb73305973306a1890903668f819d`.
- E1/E3 outcome contract and E4/E6 safety delta: `ca978f79d7fb4de8c88ea3156fa152362cc178f4`.
- One-time pinned staged formatter: `90d44720ec294d664bcac5ca10a2b85d2da419c6`; formatter workflow removed itself.
- Acceptance source branch: `stage3/round9-combined-acceptance-20261121`.
- Review pull request: [#47](https://github.com/LeviCade/OpenFront-National/pull/47).
- Conductor issue: [#45](https://github.com/LeviCade/OpenFront-National/issues/45).
- Canonical progress ledger: [#20](https://github.com/LeviCade/OpenFront-National/issues/20).

This checked-in report intentionally triggers a trusted actor's complete
combined-source PR validation after the formatter's GitHub-token push.
No completion points are awarded until the resulting exact-head source,
independent QA, and real GameRunner scenario results have passed.
GPU-backed four-mode release and protected-server confidentiality remain
separate strict release gates.

## Final targeted engine/UI regression proof — 2026-11-21

- Original combined full suite exposed five exact fixture/contract mismatches.
- Targeted #44882077973: 35 affected cases PASS following actual E1/E2/E3/E4 interoperability repair.
- Reused foreign request IDs now fail closed without terminating Game ticks.
- Targeted #44882320697: five affected source suites, full TypeScript, pinned formatter SUCCESS.
- Exact formatter-approved candidate source commit: `a3286e1177a426989fba6fbe9dd506540d355e6a`.
- One-shot targeted GitHub workflows deleted after success; no standing expensive duplicate test trigger.
- [Public owner GPU diagnostic #44881965453](https://github.com/LeviCade/OpenFront-National/actions/runs/44881965453): authentic Intel VirGL/WebGL1+2/shader evidence on NATIONAL desktop/mobile; reached spawn but DID NOT pass. Both legacy browser processes exited 0, but detailed reports were not captured. Never treat these diagnostics as signed release acceptance.

**This documentation-only commit is a trusted-actor trigger for exact-head combined full TypeScript, full tests, lint, formatting, production build, independent QA, strict WAR/MDA/CAS and dependency acceptance. The result is NOT yet a pass.**

## Formatted candidate exact-head proof

- The complete 788-file regression suite on the preceding source ran **11,589 passed / 1 skipped**; no test failure, lint zero. The only failed gate was one `RoundEightWarRequestId.test.ts` pinned-format mismatch.
- [one-time final format job #44883029431](https://github.com/LeviCade/OpenFront-National/actions/runs/44883029431) SUCCESS: full format check green and temporary formatter self-removed.
- Exact post-formatter integration candidate: `7410df53060c4228ef453c1c6b48bf34f15f6060`.
- This note initiates one complete owner-triggered exact-head combined full-source and independent QA acceptance; it does **not** certify the result ahead of completion.
