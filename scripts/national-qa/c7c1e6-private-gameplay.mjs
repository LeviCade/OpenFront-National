// C7C1E6: native input only for positive Private NATIONAL gameplay.
// GameView/decoded authority observations are read-only. No event emission,
// direct engine mutation, simulated receipt, or injected terminal state.
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { until } from "../national-staging/operator-harness.mjs";
import {
  soloSpawnFractions,
  unobstructedCanvasPoint,
} from "./browser-r11-verdict.mjs";

const panelToggle =
  'national-diplomacy-panel button[aria-controls="national-diplomacy-content"]';
const observation = `(() => {
  const g = document.querySelector("national-diplomacy-panel")?.game;
  const p = g?.myPlayer?.();
  if (!g || !p) return null;
  return {
    match: g.gameID(), actor: p.id(), tick: g.ticks(),
    spawned: p.hasSpawned(), tiles: p.numTilesOwned(), alive: p.isAlive(),
    troops: Number(p.troops()), inSpawn: g.inSpawnPhase(),
    ready: g.trustedProjectionReady(), stream: g.nationalReceiptStreamId(),
    politics: g.nationalPolitics(), politicsTick: g.nationalPoliticsTick(),
    disclosure: g.nationalPactDisclosure(), offers: g.nationalAccessionOffers(),
    conflicts: g.nationalConflicts(), conflictsTick: g.nationalConflictsTick(),
    outgoing: p.outgoingAttacks().map(a => ({
      target: a.targetID, troops: Number(a.troops), retreating: a.retreating
    })),
    smallId: p.smallID(),
  };
})()`;

export async function nativeClick(profile, selector, text = null) {
  await until(() => profile.click(selector, text), "native control", 30_000);
}

export async function nativeFill(profile, selector, value) {
  await nativeClick(profile, selector);
  await profile.send("Input.insertText", { text: value });
  assert.equal(
    await profile.evaluate(
      "document.querySelector(" + JSON.stringify(selector) + ")?.value",
    ),
    value,
  );
}

async function key(profile, value) {
  for (const type of ["keyDown", "keyUp"])
    await profile.send("Input.dispatchKeyEvent", {
      type,
      key: value,
      code: value,
    });
}

async function nativeSelect(profile, selector, value) {
  const expression =
    "document.querySelector(" + JSON.stringify(selector) + ")";
  let options;
  await until(async () => {
    options = await profile.evaluate(
      "(() => {const e=" +
        expression +
        ";return e&&!e.disabled?[...e.options].map(o=>({v:o.value,d:o.disabled})):[]})()",
    );
    return options.some((o) => o.v === value && !o.d);
  }, "eligible native select", 30_000);
  if ((await profile.evaluate(expression + "?.value")) === value) return;
  await nativeClick(profile, selector);
  await key(profile, "Home");
  for (let i = 0; i <= options.length; i++) {
    await key(profile, "Enter");
    if ((await profile.evaluate(expression + "?.value")) === value) return;
    await key(profile, "ArrowDown");
  }
  throw new Error("native selection did not commit");
}

async function panel(profile, expanded) {
  const read = () =>
    profile.evaluate(
      "document.querySelector(" +
        JSON.stringify(panelToggle) +
        ")?.getAttribute('aria-expanded')",
    );
  await until(async () => ["true", "false"].includes(await read()), "panel");
  if ((await read()) !== String(expanded)) await nativeClick(profile, panelToggle);
  await until(async () => (await read()) === String(expanded), "panel state");
}

async function hit(profile, point, button = "left") {
  await profile.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await profile.send("Input.dispatchMouseEvent", {
      type,
      ...point,
      button,
      clickCount: 1,
    });
  }
}

async function mapPoint(profile, fractions) {
  return profile.evaluate(
    "(() => {const point=" +
      unobstructedCanvasPoint.toString() +
      ";for(const canvas of document.querySelectorAll('canvas')){" +
      "const hit=point(document,canvas," +
      JSON.stringify(fractions) +
      ");if(hit)return hit;}return null;})()",
  );
}

function ownDisclosure(sample, pact) {
  return sample.disclosure?.pacts?.find((p) => p.pactId === pact) ?? null;
}

export function verifyPrivatePactViews(samples, pact, memberIds) {
  assert.equal(samples.length, 3);
  assert.equal(new Set(samples.map((s) => s.actor)).size, 3);
  for (const sample of samples) {
    const publicPact = sample.politics?.pacts?.find((p) => p.id === pact);
    assert(publicPact, "missing public pact");
    assert.deepEqual([...publicPact.memberIds].sort(), [...memberIds].sort());
    assert(!Object.hasOwn(publicPact, "terms"), "public terms leak");
    assert.equal(sample.disclosure?.recipientId, sample.actor);
    const privatePact = ownDisclosure(sample, pact);
    if (memberIds.includes(sample.actor)) {
      assert.equal(privatePact?.relationship, "member");
      assert.equal(privatePact?.terms?.admission, "leader");
      assert.equal(privatePact?.terms?.expulsion, "forbidden");
    } else {
      assert.equal(privatePact, null, "outsider received confidential terms");
    }
  }
}

export function verifyImperialVictory(samples, empire, actors) {
  assert.equal(samples.length, 3);
  assert.equal(new Set(samples.map((s) => s.actor)).size, 3);
  const expected = actors.map((nationId, i) => ({
    kind: i === 0 ? "ImperialVictor" : "EmpireVictor",
    nationId,
    empireId: empire,
  }));
  const sort = (rows) => [...rows].sort((a, b) => a.nationId.localeCompare(b.nationId));
  for (const sample of samples) {
    const v = sample.politics?.victory;
    assert.equal(v?.resolved, true);
    assert.equal(v.sovereignPowerCount, 1);
    assert(Number.isSafeInteger(v.confirmedTick) && v.confirmedTick <= sample.tick);
    assert.deepEqual(sort(v.prizes), sort(expected));
  }
  assert(samples.every((s) => s.politics.victory.confirmedTick === samples[0].politics.victory.confirmedTick));
  return samples[0].politics.victory.confirmedTick;
}

export async function runPrivateNativeGameplay({
  profiles,
  match,
  stage,
  recover,
  hostTick,
  software,
}) {
  const [a, b, c] = profiles;
  const sample = () => Promise.all(profiles.map((p) => p.evaluate(observation)));
  let current;
  const evidence = {};
  async function wait(label, predicate, ms = 60_000) {
    stage(label);
    await until(async () => {
      current = await sample();
      return current.every((s) => s?.match === match) && predicate(current);
    }, label, ms);
    return current;
  }
  const mark = (name, facts = {}) => {
    evidence[name] = facts;
    console.log("C7C1E6_STAGE " + JSON.stringify({ name, ...facts }));
  };
  await wait("native spawn phase", (ss) =>
    ss.every((s) => s.inSpawn && !s.spawned),
  );
  const actors = current.map((s) => s.actor);
  assert.equal(new Set(actors).size, 3);
  stage("three real native map spawn inputs");
  // Different starting points, same real compact map. Success is established
  // only from each authenticated GameView's own player and nonzero land.
  const fractions = soloSpawnFractions();
  await Promise.all(profiles.map(async (p, i) => {
    await panel(p, false);
    const order = [...fractions.slice(i), ...fractions.slice(0, i)];
    for (const fraction of order) {
      const prior = await p.evaluate(observation);
      if (prior?.spawned && prior.tiles > 0) return;
      assert(prior?.inSpawn, "spawn phase ended before native spawn");
      const point = await mapPoint(p, [fraction]);
      if (!point) continue;
      await hit(p, point);
      for (let j = 0; j < 8; j++) {
        await delay(150);
        const now = await p.evaluate(observation);
        if (now?.spawned && now.tiles > 0) return;
      }
    }
    throw new Error("native map spawn not confirmed");
  }));
  await wait("three spawned seats and authoritative phase end", (ss) =>
    ss.every((s, i) =>
      s.actor === actors[i] && s.spawned && s.alive && s.tiles > 0 &&
      !s.inSpawn && s.ready && s.tick <= hostTick() && s.stream
    ) && new Set(ss.map((s) => s.stream)).size === 3,
    120_000,
  );
  mark("native-spawn", { tiles: current.map((s) => s.tiles), tick: Math.min(...current.map((s) => s.tick)) });
  await Promise.all(profiles.map((p) => panel(p, true)));
  const pact = "c7-e6-private-nap";
  const empire = "c7-e6-private-empire";
  const pactRow = '[data-national-pact-id="' + pact + '"]';
  stage("native pact founding");
  await nativeFill(a, '[data-national-pact-found] input[name="id"]', pact);
  await nativeFill(a, '[data-national-pact-found] input[name="name"]', "E6 Private Pact");
  await nativeClick(a, '[data-national-pact-action="found"]');
  await wait("canonical pact founded", (ss) =>
    ss.every((s) => s.politics?.pacts?.some((p) => p.id === pact && p.memberIds.includes(actors[0]))),
  );
  stage("native pact invite");
  await nativeSelect(a, pactRow + ' select[name="candidate"]', actors[1]);
  await nativeClick(a, pactRow + ' [data-national-pact-action="invite"]');
  await wait("private invite and outsider exclusion", (ss) =>
    ownDisclosure(ss[1], pact)?.relationship === "invited" &&
    ss[2].disclosure?.recipientId === actors[2] &&
    ownDisclosure(ss[2], pact) === null,
  );
  assert.equal(ownDisclosure(current[1], pact).terms.expulsion, "forbidden");
  await nativeClick(b, pactRow + ' [data-national-pact-action="accept"]');
  await wait("canonical pact consent", (ss) =>
    ss.every((s) => s.politics?.pacts?.some((p) => p.id === pact && p.memberIds.length === 2)) &&
    ownDisclosure(ss[1], pact)?.relationship === "member",
  );
  verifyPrivatePactViews(current, pact, actors.slice(0, 2));
  mark("pact-consent-recipient-secrecy", { members: 2, outsiders: 1 });

  stage("native empire founding");
  await nativeFill(a, "#national-empire-id", empire);
  await nativeClick(a, 'form button[type="submit"]', "Found Empire");
  await wait("canonical empire founded", (ss) =>
    ss.every((s) => s.politics?.empires?.some((e) => e.id === empire && e.leaderId === actors[0])),
  );
  const membership = (s, ids) => {
    const e = s.politics?.empires?.find((e) => e.id === empire);
    return e?.leaderId === actors[0] && e.memberIds.length === ids.length &&
      ids.every((id) => e.memberIds.includes(id));
  };
  async function accession(p, index) {
    await panel(a, true);
    await panel(p, true);
    stage("native accession offer");
    await nativeSelect(a, "#national-accession-candidate", actors[index]);
    await nativeClick(a, "#national-offer-accession");
    await wait("recipient-only accession invitation", (ss) =>
      ss[index].offers?.offers?.some((o) => o.empireId === empire && o.candidateId === actors[index]) &&
      ss[3 - index].offers?.recipientId === actors[3 - index] &&
      !ss[3 - index].offers.offers.some((o) => o.empireId === empire && o.candidateId === actors[index]),
    );
    await nativeSelect(p, "#national-invitation-empire", empire + ":" + actors[index]);
    await nativeClick(p, "#national-accept-accession");
  }
  await accession(b, 1);
  await wait("canonical imperial accession", (ss) =>
    ss.every((s) => membership(s, actors.slice(0, 2)) && !s.politics?.victory),
  );
  mark("imperial-accession", { members: 2, sovereigns: 2 });

  // A national war leaves the member B and its own legal authority distinct.
  stage("native formal WAR");
  await nativeSelect(a, "#national-war-target", actors[2]);
  await nativeClick(a, "#national-declare-war");
  const active = (s) => s.conflicts?.layers?.find((l) =>
    l.scope === "national" && l.endedTick === null &&
    [l.first.id, l.second.id].includes(actors[0]) &&
    [l.first.id, l.second.id].includes(actors[2]),
  );
  await wait("canonical declared WAR", (ss) => ss.every((s) => active(s)));
  const war = active(current[0]).id;
  mark("formal-war", { scope: "national", tick: current[0].tick });

  stage("real target-aware native radial assault");
  const before = current[2];
  const attackBefore = current[0].outgoing.length;
  await panel(a, false);
  let point;
  await until(async () => {
    point = await a.evaluate(
      "(() => {const e=[...document.querySelectorAll('[data-national-map-target-id]')].find(n=>n.getAttribute('data-national-map-target-id')===" +
      JSON.stringify(actors[2]) +
      ");if(!e)return null;const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const top=document.elementFromPoint(x,y);return r.width&&r.height&&top?.tagName==='CANVAS'?{x,y}:null;})()",
    );
    return Boolean(point);
  }, "real visible enemy land", 60_000);
  await hit(a, point, "right");
  let radial;
  await until(async () => {
    radial = await a.evaluate(
      "(() => {const m=document.querySelector('.radial-menu-container');const e=m?.querySelector('.center-button-hitbox');if(!e||m.getAttribute('data-target-player-id')!==" +
      JSON.stringify(actors[2]) +
      "||getComputedStyle(e).cursor!=='pointer')return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()",
    );
    return Boolean(radial);
  }, "native enabled attack", 30_000);
  await hit(a, radial);
  await wait("authoritative outgoing military attack", (ss) =>
    ss[0].outgoing.length > attackBefore &&
    ss[0].outgoing.some((x) => x.target === ss[2].smallId && x.troops > 0 && !x.retreating),
  );
  await wait("actual opponent combat losses", (ss) =>
    ss[2].alive && (ss[2].tiles < before.tiles || ss[2].troops < before.troops),
  );
  mark("combat", { targetTilesBefore: before.tiles, targetTilesAfter: current[2].tiles, targetTroopsBefore: before.troops, targetTroopsAfter: current[2].troops });

  stage("native peace proposal");
  await panel(a, true);
  await nativeSelect(a, "#national-peace-war-id", war);
  await nativeClick(a, "#national-propose-peace");
  await wait("recipient peace motion", (ss) =>
    ss[2].conflicts?.motions?.some((m) => m.layerId === war && m.acceptedTick === null),
  );
  const motion = current[2].conflicts.motions.find((m) => m.layerId === war && m.acceptedTick === null).id;

  stage("durable same-match restart before settlement");
  const previous = current.map((s) => ({ actor: s.actor, stream: s.stream, tick: s.tick }));
  const recovered = await recover(previous);
  await wait("three original principals with fresh recovery streams", (ss) =>
    ss.every((s, i) =>
      s.actor === previous[i].actor && s.stream && s.stream !== previous[i].stream &&
      s.tick > previous[i].tick && s.tick <= hostTick() && s.ready && membership(s, actors.slice(0, 2))
    ) && new Set(ss.map((s) => s.stream)).size === 3 &&
    ss[2].conflicts?.motions?.some((m) => m.id === motion && m.acceptedTick === null),
    120_000,
  );
  mark("durable-recovery", recovered);
  await panel(c, true);
  await nativeSelect(c, "#national-peace-motion-id", motion);
  await nativeClick(c, "#national-accept-peace");
  await wait("canonical peace accepted after restore", (ss) =>
    ss.every((s) => s.conflicts?.layers?.some((l) => l.id === war && l.endedTick !== null)),
  );
  mark("peace", { tick: current[0].tick });

  // Original SOV-03: independent surviving nation voluntarily accedes; the
  // actual engine, not the harness, must set and publish last-sovereign victory.
  await accession(c, 2);
  await wait("canonical last-sovereign victory", (ss) =>
    ss.every((s) => membership(s, actors) && s.politics?.victory?.resolved === true),
  );
  const victoryTick = verifyImperialVictory(current, empire, actors);
  assert(victoryTick <= hostTick());
  mark("canonical-victory", { victoryTick, sovereignPowers: 1, imperialVictors: 1, empireVictors: 2 });
  return { match, participants: 3, software, evidence };
}
