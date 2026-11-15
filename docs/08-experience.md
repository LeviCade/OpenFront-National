# 08 — UI, accessibility, and player experience

## One exceptional difficulty

NATIONAL appears **above Impossible** in Solo FFA difficulty selection with a dramatic **gold crown-and-shield icon** and a concise promise: "Every nation fights to win. Deep diplomacy, sovereign empires, and one final world power." Provide a brief rules summary explaining that it substantially changes gameplay and victory.

This is a *new ruleset*, not the claim that the official upstream difficulty already has these mechanics.

## Core navigation

- **Coalitions tab:** discover public coalition rosters, see membership and leadership, create NAP/MDA, invite/apply, treaty clauses for one's own coalitions, constitutional votes, timed notices and betrayal/withdrawal.
- **Empire governance panel:** emperor-only constitutional authority; treasury, construction, war delegation, defense response, all three army modes, trade policy, sanction response, dissolution and leadership transfer.
- **National diplomacy bar:** declare scoped war, propose/accept peace, embargo, issue or respond to secondary sanctions, present coercive ultimatum, seek empire accession.
- **War dashboard:** list active national conflicts and empire-wide layers independently. Display which authority may negotiate each. Ending one layer must visibly preserve underlying individual war records.
- **Intelligence overlay:** differentiate public, visible, last-seen (if retained), treaty-shared, imperial-shared and purchased intelligence.
- **Diplomatic event history:** declarations, peace, betrayal, amendment votes, sanctions deadlines, forced levy, imperial transfers, the Ungovernable and collapse.

## Default interaction pattern

Start simple. A player should be able to select a nation and declare war with one clear action; if treaty membership prohibits the action, require explicit Betray first. Accept a peace proposal with one confirmation; don't require lengthy bargaining.

More advanced coalition constitutions, standing imperial policy and intelligence should live in an optional detail view, not interrupt every click. The automatic defense levy occurs without a pop-up for each incoming invasion.

## Secrecy and honest information

Public coalition roster and type can be inspected by any player. Confidential treaty terms only appear to an existing member or recipient of a pending invitation/offer. Do **not** put a warning in an outsider's UI revealing secret levy percentages or automatic empire-wide response policy before they attack.

Display consequences of *one's own* treaty and empire policies clearly. Do not leak unseen enemy structures, troop strength, fleet positions or landing destinations through tooltips, notifications, request payloads, activity feed, or UI affordances.

## Specific spectacles

- **Empire Victory:** Imperial Nation gets an Imperial Victor celebration; surviving constituent states receive clearly differentiated Empire Victor outcome.
- **Imperial Transfer:** high-impact but legible leadership event; never erase active wars or ongoing campaigns.
- **The Ungovernable:** unmistakable 10-second in-game transfer-or-collapse notice with safe attention-grabbing animation, not photosensitive strobe flashes.
- **Coercive Ultimatum:** distinguish demanded action, explicit threatened consequence, real deadline, and options to accept or defy.
- **War and peace:** make national vs empire-wide war distinct with labels; an empire-wide peace should visibly indicate surviving member-specific wars.
- **Naval blockade:** visually explain why a neutral trade ship turned home and earned no revenue.

## Quality criteria

Accessible color contrast, screen-reader labels, reduced-motion support, mobile legibility, interaction under latency, keyboard controls where practical, localization-ready strings, and a minimum of unnecessary modal dialogs. Make it understandable *which real rule caused an event*.

**OPEN:** final visual assets, precise component layouts and whether user-facing coalition policies are presets, advanced options, or both.
