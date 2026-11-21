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
