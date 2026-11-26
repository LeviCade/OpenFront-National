import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseAdjacentSpawnSites,
  verifyImperialVictory,
  verifyPrivatePactViews,
} from "./c7c1e6-private-gameplay.mjs";

const actors = ["alpha", "bravo", "charlie"];
const pact = "pact";
const empire = "empire";
function pactSamples() {
  return actors.map((actor, i) => ({
    actor,
    politics: { pacts: [{ id: pact, memberIds: actors.slice(0, 2) }] },
    disclosure: {
      recipientId: actor,
      pacts:
        i === 2
          ? []
          : [
              {
                pactId: pact,
                relationship: "member",
                terms: { admission: "leader", expulsion: "forbidden" },
              },
            ],
    },
  }));
}
function victorySamples() {
  return actors.map((actor) => ({
    actor,
    tick: 110,
    politics: {
      victory: {
        sovereignPowerCount: 1,
        resolved: true,
        confirmedTick: 100,
        prizes: actors.map((nationId, i) => ({
          nationId,
          empireId: empire,
          kind: i === 0 ? "ImperialVictor" : "EmpireVictor",
        })),
      },
    },
  }));
}

await test("pact witness rejects outsider private canary, public terms, wrong recipient", () => {
  verifyPrivatePactViews(pactSamples(), pact, actors.slice(0, 2));
  const leak = pactSamples();
  leak[2].disclosure.pacts = leak[0].disclosure.pacts;
  assert.throws(() => verifyPrivatePactViews(leak, pact, actors.slice(0, 2)));
  const publicLeak = pactSamples();
  publicLeak[0].politics.pacts[0].terms = {};
  assert.throws(() =>
    verifyPrivatePactViews(publicLeak, pact, actors.slice(0, 2)),
  );
  const wrong = pactSamples();
  wrong[2].disclosure.recipientId = actors[0];
  assert.throws(() => verifyPrivatePactViews(wrong, pact, actors.slice(0, 2)));
});

await test("victory witness rejects unresolved, two sovereigns, false crown and future ticks", () => {
  assert.equal(verifyImperialVictory(victorySamples(), empire, actors), 100);
  for (const mutate of [
    (v) => {
      v.resolved = false;
    },
    (v) => {
      v.sovereignPowerCount = 2;
    },
    (v) => {
      v.prizes[0].kind = "EmpireVictor";
    },
    (v) => {
      v.confirmedTick = 111;
    },
    (v) => {
      v.prizes.pop();
    },
    (v) => {
      v.confirmedTick = 99;
    },
  ]) {
    const samples = victorySamples();
    mutate(samples[1].politics.victory);
    assert.throws(() => verifyImperialVictory(samples, empire, actors));
  }
});

await test("spawn site planner keeps the attack pair adjacent without overlapping", () => {
  const sites = chooseAdjacentSpawnSites(
    128,
    128,
    () => true,
    () => true,
  );
  assert(sites);
  const [a, b, c] = sites;
  assert.equal(Math.abs(a.x - c.x) + Math.abs(a.y - c.y), 9);
  assert(Math.hypot(a.x - b.x, a.y - b.y) >= 18);
  assert.equal(
    chooseAdjacentSpawnSites(
      128,
      128,
      () => false,
      () => true,
    ),
    null,
  );
  assert.equal(
    chooseAdjacentSpawnSites(
      128,
      128,
      () => true,
      () => false,
    ),
    null,
  );
});
