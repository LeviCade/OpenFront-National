import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { describe, it, expect } from "vitest";
import {
  verifyC4Lane,
  verifyC4Release,
} from "../../../scripts/national-qa/c4-journey-evidence.mjs";
import { validateJourney } from "../../../scripts/national-qa/c4-journey-semantics.mjs";
const modes = [
  "national-solo-desktop",
  "national-solo-mobile",
  "legacy-desktop",
  "legacy-mobile",
  "private-national",
];
const national = [
  "start",
  "spawn",
  "found",
  "admit",
  "war",
  "attack",
  "illegal",
  "peace",
  "crown",
  "victory",
];
const legacy = ["start", "spawn", "legacy-action"];
function fixture(mode) {
  const h = (n) => n.toString(16).padStart(64, "0");
  const privateMode = mode === "private-national";
  const phases = mode.startsWith("legacy")
    ? legacy
    : privateMode
      ? [
          ...national.slice(0, -1),
          "reconnect",
          "cross-principal",
          "stale-socket",
          "replay",
          "spectator",
          "victory",
        ]
      : national;
  const identity = { sourceSha: "a".repeat(40), mode, matchId: "game-1" };
  const trusted = {
    ...identity,
    runnerId: "runner-1",
    hostId: "host-1",
    renderer: "Intel verified owner browser",
    executionKind: "owner-observed",
    authKind: "local-registered",
  };
  const transitions = phases.map((phase, i) => {
    let before = {},
      after = {};
    if (phase === "start") {
      before.mapReady = false;
      after = {
        mapReady: true,
        mapTiles: 100,
        nationalAuthority: !mode.startsWith("legacy"),
        gameType: privateMode ? "private" : "solo",
      };
    }
    if (phase === "spawn") {
      before.tiles = 0;
      after.tiles = 1;
    }
    if (phase === "found") {
      before.organization = null;
      after.organization = "empire";
    }
    if (phase === "admit") {
      before.members = 1;
      after.members = 2;
    }
    if (phase === "war") {
      before = {
        war: false,
        actorSovereign: "empire",
        targetSovereign: "C",
      };
      after.war = true;
    }
    if (phase === "attack") {
      before = {
        targetTiles: 5,
        targetTroops: 10,
        actorTroops: 20,
        war: true,
        actorSovereign: "empire",
        targetSovereign: "C",
      };
      after = { targetTiles: 4, targetTroops: 8, actorTroops: 15 };
    }
    if (phase === "peace") {
      before.war = true;
      after.war = false;
    }
    if (phase === "crown") {
      before.crown = "A";
      after.crown = "B";
    }
    if (phase === "victory") {
      before = { sovereigns: 2, winner: null };
      after = {
        sovereigns: 1,
        winCheck: true,
        winner: "empire",
        soleSovereign: "empire",
      };
    }
    if (phase === "legacy-action") {
      before.tiles = 1;
      after = { tiles: 2, nationalAuthority: false };
    }
    if (phase === "reconnect") {
      before = { socket: "old", seat: "s0" };
      after = { socket: "new", seat: "s0" };
    }
    const neg = [
      "illegal",
      "cross-principal",
      "stale-socket",
      "replay",
      "spectator",
    ].includes(phase);
    const actor = phase === "admit" ? "B" : phase === "peace" ? "C" : "A";
    const target =
      phase === "admit" || phase === "peace"
        ? "A"
        : phase === "war" || phase === "attack"
          ? "C"
          : "B";
    const offer = ["admit", "peace"].includes(phase)
      ? {
          actor: target,
          recipient: actor,
          requestId: "offer-" + i,
          receiptSha256: h(900 + i),
          tick: i * 2,
        }
      : null;
    return {
      phase,
      actor,
      target,
      offer,
      replayedRequestId: phase === "replay" ? "r5" : null,
      claimedActor: phase === "cross-principal" ? "B" : null,
      spectator: phase === "spectator",
      socketId: phase === "stale-socket" ? "old" : null,
      requestId: "r" + i,
      receiptSha256: h(i + 1),
      tickBefore: i * 2,
      tickAfter: i * 2 + 1,
      beforeStateSha256: h(100 + i),
      afterStateSha256: h(200 + i),
      outcome: neg ? "rejected" : "executed",
      rejectionCode: neg ? "DENIED" : null,
      commandEffects: neg ? 0 : 1,
      before,
      after,
    };
  });
  const seats = ["A", "B", "C"].map((principal, i) => ({
    principal,
    seatId: "s" + i,
    profileId: "p" + i,
    projectionBefore: h(300 + i),
    projectionAfter: h(400 + i),
    tickBefore: 3,
    tickAfter: 9,
    matchId: "game-1",
  }));
  const browser = {
    ...identity,
    renderer: trusted.renderer,
    pointer: mode.endsWith("mobile") ? "touch" : "mouse",
    transitions: transitions.map((a, i) => ({
      phase: a.phase,
      actor: a.actor,
      target: a.target,
      offer: a.offer ? { ...a.offer } : null,
      replayedRequestId: a.replayedRequestId,
      claimedActor: a.claimedActor,
      spectator: a.spectator,
      socketId: a.socketId,
      requestId: a.requestId,
      receiptSha256: a.receiptSha256,
      tickAfter: a.tickAfter,
      screenshotSha256: h(500 + i),
    })),
    seats: seats.map((s) => ({ ...s })),
  };
  const authority = {
    ...identity,
    runnerId: trusted.runnerId,
    hostId: trusted.hostId,
    authKind: trusted.authKind,
    gameServerCount: 1,
    gameRunnerCount: 1,
    transitions,
    seats,
  };
  return { mode, browser, authority, trusted };
}
const mutations = [
  [
    "wrong SHA",
    (f) => {
      f.browser.sourceSha = "b".repeat(40);
    },
    "SOURCE_OR_MODE_MISMATCH",
  ],
  [
    "missing transition",
    (f) => {
      f.browser.transitions.pop();
    },
    "TRANSITION_MISSING_OR_EXTRA",
  ],
  [
    "absent receipt",
    (f) => {
      delete f.authority.transitions[4].receiptSha256;
    },
    "COMMAND_RECEIPT_OR_TICK_war",
  ],
  [
    "fabricated outcome",
    (f) => {
      let a = f.authority.transitions.find((a) => a.phase === "attack");
      a.after = { ...a.before };
    },
    "MILITARY_EFFECT_NOT_OBSERVED",
  ],
  [
    "wrong victory",
    (f) => {
      f.authority.transitions.find(
        (a) => a.phase === "victory",
      ).after.sovereigns = 2;
    },
    "CONSTITUTIONAL_VICTORY_NOT_OBSERVED",
  ],
  [
    "duplicate account",
    (f) => {
      f.authority.seats[1].principal = "A";
    },
    "DUPLICATE_PRIVATE_principal",
  ],
  [
    "reused projection",
    (f) => {
      f.authority.seats[1].projectionAfter =
        f.authority.seats[0].projectionAfter;
    },
    "DUPLICATE_PRIVATE_projectionAfter",
  ],
  [
    "software renderer",
    (f) => {
      f.browser.renderer = f.trusted.renderer = "SwiftShader";
    },
    "REAL_BROWSER_ENVIRONMENT_UNPROVEN",
  ],
  [
    "unlawful accepted action",
    (f) => {
      f.authority.transitions.find((a) => a.phase === "illegal").outcome =
        "executed";
    },
    "AUTHORITATIVE_OUTCOME_illegal",
  ],
  [
    "two authoritative runners",
    (f) => {
      f.authority.gameRunnerCount = 2;
    },
    "PRIVATE_HOST_OR_AUTH_UNPROVEN",
  ],
  [
    "missing tick progression",
    (f) => {
      f.authority.transitions[1].tickAfter =
        f.authority.transitions[1].tickBefore;
    },
    "COMMAND_RECEIPT_OR_TICK_spawn",
  ],
  [
    "missing bilateral offer",
    (f) => {
      delete f.authority.transitions.find((a) => a.phase === "admit").offer;
    },
    "ADMISSION_NOT_OBSERVED",
  ],
  [
    "attack own sovereign",
    (f) => {
      const a = f.authority.transitions.find((a) => a.phase === "attack");
      a.before.targetSovereign = a.before.actorSovereign;
    },
    "MILITARY_EFFECT_NOT_OBSERVED",
  ],
  [
    "fake replay without original command",
    (f) => {
      const a = f.authority.transitions.find((a) => a.phase === "replay");
      a.replayedRequestId = "never-executed";
    },
    "REPLAY_NOT_CORRELATED_TO_EXECUTED_COMMAND",
  ],
  [
    "cross-principal probe is actually same principal",
    (f) => {
      const a = f.authority.transitions.find(
        (a) => a.phase === "cross-principal",
      );
      a.claimedActor = a.actor;
    },
    "CROSS_PRINCIPAL_PROBE_MISSING",
  ],
  [
    "stale socket has no reconnect correlation",
    (f) => {
      f.authority.transitions.find((a) => a.phase === "stale-socket").socketId =
        "not-the-old-socket";
    },
    "STALE_SOCKET_PROBE_MISSING",
  ],
  [
    "spectator probe is actually an admitted participant",
    (f) => {
      f.authority.transitions.find((a) => a.phase === "spectator").spectator =
        false;
    },
    "SPECTATOR_PROBE_MISSING",
  ],
  [
    "cross game",
    (f) => {
      f.authority.matchId = "other";
    },
    "MATCH_OR_RUNNER_MISMATCH",
  ],
];

const hash = (b) => createHash("sha256").update(b).digest("hex");
function png(seed = 123456) {
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const x of bytes) {
      crc ^= x;
      for (let i = 0; i < 8; i++)
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    const len = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, bytes, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(320);
  ihdr.writeUInt32BE(240, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(1281 * 240);
  let n = seed;
  for (let y = 0; y < 240; y++)
    for (let x = 1; x < 1281; x++) {
      n ^= n << 13;
      n ^= n >>> 17;
      n ^= n << 5;
      raw[y * 1281 + x] = n & 255;
    }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function bundle(mode) {
  const f = fixture(mode);
  const screenshots = new Map(
    f.browser.transitions.map((s, i) => {
      const image = png(123456 + i);
      s.screenshotSha256 = hash(image);
      return [s.phase, image];
    }),
  );
  const browserBytes = Buffer.from(JSON.stringify(f.browser)),
    authorityBytes = Buffer.from(JSON.stringify(f.authority));
  const trusted = {
    ...f.trusted,
    browserSha256: hash(browserBytes),
    authoritySha256: hash(authorityBytes),
  };
  return { mode, browserBytes, authorityBytes, trusted, screenshots };
}
describe("C4 independent evidence oracle — synthetic tests only", () => {
  for (const mode of modes)
    it("accepts coherent fixture " + mode, () => {
      const f = fixture(mode);
      expect(
        validateJourney(mode, f.browser, f.authority, f.trusted).accepted,
      ).toBe(true);
    });
  for (const [name, mutate, reason] of mutations)
    it("rejects " + name, () => {
      const f = fixture("private-national");
      mutate(f);
      expect(
        validateJourney(f.mode, f.browser, f.authority, f.trusted),
      ).toEqual({ accepted: false, reason });
    });
  it("checks actual image bytes and pinned producer digests", () => {
    const b = bundle("legacy-desktop");
    expect(verifyC4Lane(b).accepted).toBe(true);
    b.screenshots.set("start", Buffer.alloc(2000));
    expect(verifyC4Lane(b).reason).toBe("SCREENSHOT_PNG_INVALID_start");
    const other = png();
    const report = JSON.parse(b.browserBytes.toString());
    report.transitions[0].screenshotSha256 = "f".repeat(64);
    b.browserBytes = Buffer.from(JSON.stringify(report));
    b.trusted.browserSha256 = hash(b.browserBytes);
    b.screenshots.set("start", other);
    expect(verifyC4Lane(b).reason).toBe("SCREENSHOT_DIGEST_MISMATCH_start");
    b.authorityBytes = Buffer.from("{}");
    expect(verifyC4Lane(b).reason).toBe("INDEPENDENT_ARTIFACT_DIGEST_MISMATCH");
  });
  it("rejects a reused screenshot", () => {
    const f = fixture("private-national");
    f.browser.transitions[1].screenshotSha256 =
      f.browser.transitions[0].screenshotSha256;
    expect(
      validateJourney(f.mode, f.browser, f.authority, f.trusted).reason,
    ).toBe("SCREENSHOT_REUSED_spawn");
  });
  it("rejects a missing release lane and absent physical result", () => {
    const all = modes.map(bundle),
      trustedByMode = Object.fromEntries(all.map((b) => [b.mode, b.trusted]));
    const input = { lanes: all, trustedByMode, sourceSha: "a".repeat(40) };
    expect(verifyC4Release({ ...input, lanes: all.slice(1) }).reason).toBe(
      "REQUIRED_RELEASE_LANE_MISSING_OR_DUPLICATE",
    );
    expect(verifyC4Release(input).reason).toBe(
      "INDEPENDENT_PHYSICAL_CHAIN_MISSING",
    );
  });
});
