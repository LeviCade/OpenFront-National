# C7 E4 historical snapshot witness

The unique CI workflow checks out each immutable writer independently and copies
only the test driver into that checkout. The historical installation and
engine produce raw snapshot bytes via GameRunner.snapshot. The producer
checks exact same-build continuation before uploading bytes. A separate job
checks out the current exact SHA, downloads all three artifacts from that run,
verifies source/run/toolchain/map/content identity, restores real engine state
and performs actual MDA-funded combat plus a new stamped war declaration.
The older writers' available paid reconnaissance/assessment grants are bought
with earned gold and compared through restoration; absent old capabilities
must restore as empty entitlements, never as invented paid grants. Same-build
continuation includes a byte digest at every simulated tick. The default test is same-build,
not a substitute for historical compatibility. The engine authority API is
used for historical pact formation because older writers lack native pact
intents. No private account data is used.

The digest and run metadata establish CI artifact correlation, not a
cryptographic authentication mechanism for arbitrary third-party snapshots.
The existing exact-source authenticated durable recovery gate is unchanged.
Missing artifacts or failed producers block consumer acceptance. Never
replace historical bytes with downgraded current output.

## Reproduction

The push workflow `.github/workflows/c7c1-e4-cross-build.yml` runs on the
engineer and integration refs. Each producer checks out its historical SHA,
installs its own dependencies using Node 24.15.0/npm 12.1.0 and copies only
the pinned current test driver. The manifest includes the driver SHA/digest,
writer SHA, raw content SHA-256, map file digests, record version, run/attempt
and semantic witness. The consumer runs separately after every producer passes.
The original upstream format-1 FFA regression is still run by the focused suite.

The first successful historical proof is run 45574280704, consumer
head fd612aa7ee286c1b3e87c1be2327d16a3fe05f2b. Its three raw artifacts were
independently downloaded and checked: Game versions 4/5/6, all root format 1,
map hash 2050966082, minimap hash 3142403358, header and game tick 8. These
original artifacts remain distinct evidence from later, stronger scenarios.
