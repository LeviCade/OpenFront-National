import { Structures, UnitType } from "./GameTypes";

export interface NationalImperialAdministrationView {
  readonly empireId: string;
  readonly workerIncomeBps: number;
  readonly allowedConstruction: readonly UnitType[] | null;
  readonly treasury: string;
  readonly canAmend: boolean;
  readonly armyMode?: "decentralized" | "hybrid";
  readonly hybridThresholdBps?: number;
  readonly imperialTroops?: string;
  readonly imperialTroopCapacity?: string;
}
export interface NationalImperialAdministrationWire extends NationalImperialAdministrationView {
  readonly version: 1;
  readonly recipientId: string;
  readonly tick: number;
  readonly streamId?: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const construction = new Set<unknown>([...Structures.types, UnitType.Warship]);
/** Members only, exact public membership/office + native tick/stream binding. */
export function readNationalImperialAdministration(
  value: unknown,
  politics: unknown,
  actor: string | null,
  tick: number,
  streamId?: string | null,
): NationalImperialAdministrationView | null {
  if (
    !actor ||
    !record(value) ||
    !record(politics) ||
    !Array.isArray(politics.empires) ||
    !Object.keys(value).every((k) =>
      [
        "version",
        "recipientId",
        "tick",
        "streamId",
        "empireId",
        "workerIncomeBps",
        "allowedConstruction",
        "treasury",
        "canAmend",
        "armyMode",
        "hybridThresholdBps",
        "imperialTroops",
        "imperialTroopCapacity",
      ].includes(k),
    ) ||
    value.version !== 1 ||
    value.recipientId !== actor ||
    !Number.isSafeInteger(tick) ||
    tick < 0 ||
    value.tick !== tick ||
    streamId === null ||
    value.streamId !== streamId ||
    typeof value.empireId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(value.empireId) ||
    typeof value.workerIncomeBps !== "number" ||
    !Number.isInteger(value.workerIncomeBps) ||
    value.workerIncomeBps < 0 ||
    value.workerIncomeBps > 10000 ||
    typeof value.treasury !== "string" ||
    !/^(0|[1-9][0-9]{0,127})$/.test(value.treasury) ||
    typeof value.canAmend !== "boolean"
  )
    return null;
  const empire = politics.empires.find(
    (e) =>
      record(e) &&
      e.id === value.empireId &&
      Array.isArray(e.memberIds) &&
      e.memberIds.includes(actor),
  );
  if (!empire || (empire.leaderId === actor) !== value.canAmend) return null;
  const allowed = value.allowedConstruction;
  if (
    allowed !== null &&
    (!Array.isArray(allowed) ||
      allowed.length > construction.size ||
      !allowed.every((v) => construction.has(v)) ||
      new Set(allowed).size !== allowed.length)
  )
    return null;
  const military = [value.armyMode, value.hybridThresholdBps, value.imperialTroops, value.imperialTroopCapacity];
  const hasMilitary = military.some(v => v !== undefined);
  if (hasMilitary && ((value.armyMode !== "decentralized" && value.armyMode !== "hybrid") ||
    typeof value.hybridThresholdBps !== "number" || !Number.isInteger(value.hybridThresholdBps) || value.hybridThresholdBps < 0 || value.hybridThresholdBps > 10000 ||
    typeof value.imperialTroops !== "string" || !/^(0|[1-9][0-9]{0,127})$/.test(value.imperialTroops) ||
    typeof value.imperialTroopCapacity !== "string" || !/^(0|[1-9][0-9]{0,127})$/.test(value.imperialTroopCapacity) ||
    (value.armyMode === "decentralized" && (value.imperialTroops !== "0" || value.imperialTroopCapacity !== "0")))) return null;
  return {
    ...(hasMilitary ? {
      armyMode: value.armyMode as NationalImperialAdministrationView["armyMode"],
      hybridThresholdBps: value.hybridThresholdBps as number,
      imperialTroops: value.imperialTroops as string,
      imperialTroopCapacity: value.imperialTroopCapacity as string,
    } : {}),
    empireId: value.empireId,
    workerIncomeBps: value.workerIncomeBps,
    treasury: value.treasury,
    canAmend: value.canAmend,
    allowedConstruction: allowed === null ? null : ([...allowed] as UnitType[]),
  };
}
export function validateNationalImperialPacket(
  value: unknown,
  politics: unknown,
  actor: string | null,
  tick: number,
  streamId?: string,
): void {
  if (
    value !== undefined &&
    !readNationalImperialAdministration(value, politics, actor, tick, streamId)
  )
    throw new Error("NATIONAL invalid imperial administration disclosure");
}
