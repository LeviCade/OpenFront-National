import type { GameUpdates } from "@openfront/engine-api/game/GameTypes";
/**
 * Authenticated NATIONAL server -> browser frame payload.
 *
 * Called ONLY after GameRunner passed the canonical host-only tick through
 * NationalServerRecipientSession. This is an explicit post-E3 allowlist, not
 * JSON.stringify(Game) or a client-selected observation. A browser must
 * NEVER receive a Game, GameSnapshot, raw Turn, ledger, account token or
 * hidden authority source.
 *
 * E2 owns websocket framing/ingress; E4 can decode this into the existing
 * GameUpdateViewData shape without running a client-side authoritative Game.
 */
import {
  GameUpdateType,
  type GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";

export const NATIONAL_VIEW_VERSION = 1;
export const NATIONAL_VIEW_MAX_BYTES = 16 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is JsonRecord =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const serialBuckets = [
  GameUpdateType.Player,
  GameUpdateType.Unit,
  GameUpdateType.SpawnPhaseEnd,
  GameUpdateType.GamePaused,
] as const;

function numbers(v: unknown, max: number): number[] {
  if (
    !Array.isArray(v) ||
    v.length > max ||
    !v.every((x) => typeof x === "number" && Number.isFinite(x))
  ) {
    throw new Error("NATIONAL invalid packed recipient buffer");
  }
  return v as number[];
}

/**
 * Serialize ONLY the E3-permitted update fields. The caller must pass the
 * output of an authenticated NationalServerRecipientSession, NEVER host Game
 * updates or an object supplied by a socket. No object spread of the packet
 * itself is allowed here, even when its TypeScript type permits new fields.
 */
export function encodeNationalViewPayload(packet: GameUpdateViewData): string {
  if (!Number.isSafeInteger(packet.tick) || packet.tick < 0) {
    throw new Error("NATIONAL recipient tick is invalid");
  }
  const updates: JsonRecord = {};
  for (const kind of serialBuckets) {
    const items = packet.updates[kind] ?? [];
    if (!Array.isArray(items))
      throw new Error("NATIONAL update bucket invalid");
    updates[kind] = items;
  }
  const politics = packet.nationalPolitics;
  const accession = packet.nationalAccessionOffers;
  const receipts = packet.nationalCommandResults;
  // E3's WAR/peace participant projection is separate from the raw E1
  // WarLedger. Only the already-filtered public/participant DTO is forwarded.
  const conflicts = (
    packet as GameUpdateViewData & {
      nationalConflicts?: {
        version: 1;
        recipientId: string;
        layers: readonly unknown[];
        motions: readonly unknown[];
      };
    }
  ).nationalConflicts;
  const payload = JSON.stringify({
    version: NATIONAL_VIEW_VERSION,
    tick: packet.tick,
    ...(politics === undefined
      ? {}
      : {
          nationalPolitics: {
            empires: politics.empires.map((e) => ({
              id: e.id,
              leaderId: e.leaderId,
              memberIds: [...e.memberIds],
            })),
            warnings: politics.warnings.map((w) => ({
              empireId: w.empireId,
              deadlineMs: w.deadlineMs,
              remainingMs: w.remainingMs,
              blockedByAssetDisposition: w.blockedByAssetDisposition,
            })),
            victory:
              politics.victory === null
                ? null
                : {
                    sovereignPowerCount: politics.victory.sovereignPowerCount,
                    resolved: politics.victory.resolved,
                    prizes: politics.victory.prizes.map((p) => ({ ...p })),
                  },
          },
        }),
    ...(accession === undefined
      ? {}
      : {
          nationalAccessionOffers: {
            version: 1,
            recipientId: accession.recipientId,
            offers: accession.offers.map((o) => ({
              empireId: o.empireId,
              candidateId: o.candidateId,
              proposerId: o.proposerId,
              recipientId: o.recipientId,
            })),
          },
        }),
    ...(receipts === undefined
      ? {}
      : {
          nationalCommandResults: receipts.map((r) => ({
            recipientId: r.recipientId,
            actorId: r.actorId,
            type: r.type,
            accepted: r.accepted,
            tick: r.tick,
            sequence: r.sequence,
            requestId: r.requestId,
            reason: r.reason,
            empireId: r.empireId,
            commandTargetId: r.commandTargetId,
            warId: r.warId,
            motionId: r.motionId,
          })),
        }),
    ...(conflicts === undefined
      ? {}
      : {
          nationalConflicts: {
            version: conflicts.version,
            recipientId: conflicts.recipientId,
            // WAR/public participant terms are enumerated explicitly.
            // Never copy new raw E1 ledger fields or treaty clauses.
            layers: conflicts.layers.map((item) => {
              if (!isRecord(item) || !isRecord(item.first) ||
                  !isRecord(item.second)) {
                throw new Error("NATIONAL unverified public WAR layer");
              }
              return {
                id: item.id,
                scope: item.scope,
                first: { kind: item.first.kind, id: item.first.id },
                second: { kind: item.second.kind, id: item.second.id },
                declaredBy: item.declaredBy,
                startedTick: item.startedTick,
                endedTick: item.endedTick,
              };
            }),
            motions: conflicts.motions.map((item) => {
              if (!isRecord(item)) {
                throw new Error("NATIONAL unverified peace motion");
              }
              return {
                id: item.id,
                layerId: item.layerId,
                proposedBy: item.proposedBy,
                proposingSide: item.proposingSide,
                proposedTick: item.proposedTick,
                acceptedTick: item.acceptedTick,
                acceptedBy: item.acceptedBy,
              };
            }),
          },
        }),
    updates,
    packedTileUpdates: Array.from(packet.packedTileUpdates),
    ...(packet.packedPlayerUpdates === undefined
      ? {}
      : { packedPlayerUpdates: Array.from(packet.packedPlayerUpdates) }),
    ...(packet.packedUnitUpdates === undefined
      ? {}
      : { packedUnitUpdates: Array.from(packet.packedUnitUpdates) }),
    ...(packet.packedMissileTimers === undefined
      ? {}
      : { packedMissileTimers: Array.from(packet.packedMissileTimers) }),
    ...(packet.playerNameViewData === undefined
      ? {}
      : { playerNameViewData: packet.playerNameViewData }),
    ...(packet.tickExecutionDuration === undefined
      ? {}
      : { tickExecutionDuration: packet.tickExecutionDuration }),
    ...(packet.pendingTurns === undefined
      ? {}
      : { pendingTurns: packet.pendingTurns }),
  });
  if (payload.length > NATIONAL_VIEW_MAX_BYTES) {
    throw new Error("NATIONAL recipient payload exceeds size limit");
  }
  return payload;
}

/** Decode the explicit wire form into the existing E4 GameView update API.
 * This is NOT authority. The server is always the exclusive game executor.
 */
export function decodeNationalViewPayload(payload: string): GameUpdateViewData {
  if (payload.length > NATIONAL_VIEW_MAX_BYTES) {
    throw new Error("NATIONAL recipient payload exceeds size limit");
  }
  const value: unknown = JSON.parse(payload);
  if (
    !isRecord(value) ||
    value.version !== NATIONAL_VIEW_VERSION ||
    !Number.isSafeInteger(value.tick) ||
    Number(value.tick) < 0 ||
    !isRecord(value.updates)
  ) {
    throw new Error("NATIONAL recipient wire header invalid");
  }
  const legal = new Set([
    "version",
    "tick",
    "nationalPolitics",
    "nationalAccessionOffers",
    "nationalCommandResults",
    "nationalConflicts",
    "updates",
    "packedTileUpdates",
    "packedPlayerUpdates",
    "packedUnitUpdates",
    "packedMissileTimers",
    "playerNameViewData",
    "tickExecutionDuration",
    "pendingTurns",
  ]);
  if (Object.keys(value).some((k) => !legal.has(k))) {
    throw new Error("NATIONAL recipient wire contains forbidden field");
  }
  const bucketIds = Object.values(GameUpdateType).filter(
    (x): x is number => typeof x === "number",
  );
  const updates = Object.fromEntries(
    bucketIds.map((k) => [k, []]),
  ) as unknown as GameUpdates;
  for (const key of Object.keys(value.updates)) {
    if (!serialBuckets.some((k) => String(k) === key)) {
      throw new Error("NATIONAL recipient wire update type forbidden");
    }
  }
  for (const kind of serialBuckets) {
    const items = value.updates[kind];
    if (!Array.isArray(items) || items.length > 4096) {
      throw new Error("NATIONAL recipient wire update bucket invalid");
    }
    (updates as unknown as Record<number, unknown[]>)[kind] = items;
  }
  const asFloat = (v: unknown) =>
    v === undefined ? undefined : new Float64Array(numbers(v, 2_000_000));
  const asUint = (v: unknown) =>
    v === undefined ? undefined : new Uint32Array(numbers(v, 2_000_000));
  const tile = asUint(value.packedTileUpdates);
  if (tile === undefined || tile.length % 2 !== 0) {
    throw new Error("NATIONAL recipient tile update invalid");
  }
  // Only the fields named in the permit list can enter E4 GameView. The
  // validator never trusts a browser assertion of recipient/actor identity:
  // E4 separately verifies the principal on all private political DTOs.
  return {
    tick: value.tick as number,
    updates,
    packedTileUpdates: tile,
    ...(value.nationalPolitics === undefined
      ? {}
      : { nationalPolitics: value.nationalPolitics }),
    ...(value.nationalAccessionOffers === undefined
      ? {}
      : { nationalAccessionOffers: value.nationalAccessionOffers }),
    ...(value.nationalCommandResults === undefined
      ? {}
      : { nationalCommandResults: value.nationalCommandResults }),
    ...(value.nationalConflicts === undefined
      ? {}
      : { nationalConflicts: value.nationalConflicts }),
    ...(value.packedPlayerUpdates === undefined
      ? {}
      : { packedPlayerUpdates: asFloat(value.packedPlayerUpdates) }),
    ...(value.packedUnitUpdates === undefined
      ? {}
      : { packedUnitUpdates: asFloat(value.packedUnitUpdates) }),
    ...(value.packedMissileTimers === undefined
      ? {}
      : { packedMissileTimers: asUint(value.packedMissileTimers) }),
    ...(value.playerNameViewData === undefined
      ? {}
      : { playerNameViewData: value.playerNameViewData }),
    ...(value.tickExecutionDuration === undefined
      ? {}
      : { tickExecutionDuration: value.tickExecutionDuration }),
    ...(value.pendingTurns === undefined
      ? {}
      : { pendingTurns: value.pendingTurns }),
  } as GameUpdateViewData;
}
