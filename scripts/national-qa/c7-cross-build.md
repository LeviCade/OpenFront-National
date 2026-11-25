# C7 E4 historical snapshot witness

The unique CI workflow checks out each immutable writer independently and copies
only the test driver into that checkout. The historical installation and
engine produce raw snapshot bytes via GameRunner.snapshot. The producer
checks exact same-build continuation before uploading bytes. A separate job
checks out the current exact SHA, downloads all three artifacts from that run,
verifies source/run/toolchain/map/content identity, restores real engine state
and performs a new stamped war declaration. The default test is same-build,
not a substitute for historical compatibility. The engine authority API is
used for historical pact formation because older writers lack native pact
intents. No private account data is used.

The digest and run metadata establish CI artifact correlation, not a
cryptographic authentication mechanism for arbitrary third-party snapshots.
The existing exact-source authenticated durable recovery gate is unchanged.
Missing artifacts or failed producers block consumer acceptance. Never
replace historical bytes with downgraded current output.
