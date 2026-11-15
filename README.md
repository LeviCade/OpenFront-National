# OpenFront: NATIONAL 👑

**The Age of Sovereignty — a proposed strategic overhaul of OpenFront Solo Free-for-All.**

> **One world. Independent nations. Absolute empires. One final victory.**
>
> Every nation exists to **WIN**. It does not exist to balance the game, attack the human, or sacrifice itself for the collective good.

**Status:** Stage 1 vision complete. Stage 2 is being imported and verified on a dedicated branch; it has **not yet been accepted or merged into main**. Stage 3 coding has not begun. See [permanent project handoff](PROJECT_HANDOFF.md).

**Project:** Independent, community-driven experimental project by the maintainers of this repository. It is **not** the official OpenFront.io repository and does not claim endorsement by the upstream maintainers.

**Upstream:** [openfrontio/OpenFrontIO](https://github.com/openfrontio/OpenFrontIO) · [OpenFront.io](https://openfront.io/)

**New chat / new engineer?** Begin with [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) for the complete vision, the pinned upstream source, the live migration run, licensing caveats, recovery steps, and Stage 3 gates.

## The ambition

NATIONAL is a proposed difficulty *above Impossible* and an interconnected geopolitical ruleset for Solo FFA. Nations compete for sovereignty, survival, and victory with the same information and mechanics available to a human, but with far stronger strategic reasoning. Diplomacy is not a decorative button. War is not a vague hostility score. Empires are not ordinary teams. Economic coercion is not a scripted event. Power must be credible, and treaties have executable consequences.

A tiny island fortress can survive an enormous land empire. A small state can seek an empire's protection while surrendering the chance at the highest-prestige victory. Multiple nations may form constitutional pacts, pool troops automatically for defense, or submit to one imperial sovereign. An empire can be politically unified but militarily decentralized, and individual members can fight limited wars while the empire remains formally at peace.

## Three development stages

| Stage | Goal | State |
| --- | --- | --- |
| **1 — Vision** | Establish durable design principles, complete rule specifications, scenarios, and acceptance criteria in GitHub | **Documentation baseline complete** |
| **2 — Migration** | Import source with provenance, license compliance, baseline tests, and upstream update strategy | **Migration branch active; not verified** |
| **3 — Coding** | Implement NATIONAL incrementally with deterministic simulation, tests, UX, AI, and performance gates | Not started |

**Stage 1 is documentation-only.** No claim of implemented features should be inferred from the documents in this repo.

## NATIONAL pillars

1. **Self-interested intelligence:** every nation seeks the best realistic route to victory, assesses retaliation and survival, remembers diplomacy, and never targets a participant merely because they are human.
2. **Three coalition types:** Non-Aggression Pacts, Mutual Defense Alliances, and exclusive sovereign Empires.
3. **Constitutional politics:** admission, leadership, expulsion, amendment, treaty secrecy, and unconditional independent-state withdrawal by betrayal.
4. **Actual empires:** a single Imperial Nation, subordinate member states, unilateral imperial law, configurable treasury/construction/military policies, supreme leadership transfer, and exceptional collapse.
5. **Formal war and peace:** declared national and imperial wars, negotiated peace, layered war records, embargoes, wartime piracy, and automatic defensive levies.
6. **Coercion and trade power:** ultimatums, secondary sanctions, member-specific proxy wars, naval blockades, and practical consequences for threats that cannot be enforced.
7. **Intelligence and fog of war:** limited default knowledge, geographic detection, hidden coalition rules, espionage investments, and empire-wide intelligence sharing.
8. **Sovereign victory:** win only when **one independent nation or one empire** is the final surviving sovereign power, not merely by reaching a territory percentage.

## Read the design

**Start here:** [Documentation index](docs/README.md)

| Document | Scope |
| --- | --- |
| [Vision and non-negotiables](docs/00-vision.md) | Project philosophy, AI fairness, simplicity, authority |
| [Victory and NATIONAL difficulty](docs/01-victory-and-difficulty.md) | One-sovereign endgame, win prestige, difficulty scope |
| [National AI and memory](docs/02-national-ai.md) | Strategic objectives, national-interest decisions, credibility |
| [Coalitions and constitutions](docs/03-coalitions.md) | Pacts, alliances, memberships, betrayal, automatic levies |
| [Imperial sovereignty](docs/04-empires.md) | Imperial leadership, governance, army modes, finance, collapse |
| [War and peace](docs/05-war-and-peace.md) | Layered wars, delegations, peace, combat transitions |
| [Economic coercion and blockades](docs/06-sanctions-and-blockades.md) | Embargoes, sanctions, ultimatums, legal piracy, neutral shipping |
| [Fog of war and intelligence](docs/07-intelligence.md) | Public knowledge, detection, coalition visibility, espionage |
| [User experience](docs/08-experience.md) | NATIONAL icon, coalition tab, diplomacy, clarity and accessibility |
| [Architecture and verification](docs/09-engineering-constraints.md) | Determinism, authoritative state, tests, performance |
| [Scenario acceptance matrix](docs/10-scenarios.md) | Concrete cross-feature behavior and edge cases |
| [Decisions and open questions](docs/11-decisions.md) | Locked design vs balancing values still requiring experiments |
| [Deferred economics](docs/12-deferred-economics.md) | Currencies, goods, debt, pricing reforms — expressly out of scope |
| [Migration plan](docs/13-migration-plan.md) | Stage 2 provenance, licenses, clean baseline |
| [Implementation roadmap](docs/14-roadmap.md) | Stage 3 delivery order and release gates |
| [Vocabulary](docs/GLOSSARY.md) | Precise, shared terms for contributors |

## The golden rules

- **All nations are competitors.** Human control is not a strategic signal or an AI targeting criterion.
- **No hidden AI cheats.** NATIONAL intelligence uses only information a nation can legitimately know.
- **Real enforcement.** A treaty, levy, embargo, transfer, or war must change actual authoritative game state. No magic consequences or free resources.
- **No mandatory dogpiling.** A runaway leader matters only when countering it plausibly improves a particular nation's own prospects.
- **Empire sovereignty is exclusive.** No imperial member, including the emperor, can belong to an outside coalition; the imperial sovereign can delegate limited national diplomacy.
- **One empire, one supreme leader.** Member states share the empire's victory but not equal prestige.
- **Keep OpenFront recognizable.** Complex strategic decisions should not bury a fast game under forms or frequent modal dialogs.

## Source relationship and attribution

The official OpenFront source is licensed under the **GNU Affero General Public License v3.0**; upstream asset materials have a separate **CC BY-SA 4.0** licensing scheme and additional notices. **During Stage 2**, preserve applicable upstream license texts, attribution, copyright and required notices, source availability obligations, and other applicable licensing requirements. See [migration plan](docs/13-migration-plan.md). The name NATIONAL and this design proposal should not be understood as an official OpenFront.io release.

## Contributing

For now, the repository is building a single, coherent and testable design before code migration. See [CONTRIBUTING.md](CONTRIBUTING.md) and [the decision register](docs/11-decisions.md). Propose changes with clear mechanics, enforcement, exploit analysis, AI implications, and regression scenarios.

---

**NATIONAL: THE AGE OF SOVEREIGNTY.** 👑🌍
