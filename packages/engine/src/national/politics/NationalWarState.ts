/**
 * Canonical WAR/LEVY state service bound to the single running GameImpl.
 * Delegates to E2 WarLedger and DefenseLevyLedger; never duplicates politics.
 */
import { z } from "zod";
import {
  DefenseLevyLedger,
  type DefenseResult,
  type IncomingDefense,
  type LevyLedgerState,
  type TroopDebitTransactionAdapter,
} from "../conflict/DefenseLevy";
import {
  WarLedger,
  type ConflictLedgerState,
  type ConflictParty,
  type PoliticsPort,
} from "../conflict/WarLedger";

const id = z.string().min(1).max(256);
const tick = z.number().int().nonnegative();
const party = z.object({ kind: z.enum(["nation", "empire"]), id });
const warLayer = z.object({
  id,
  scope: z.enum(["national", "imperial"]),
  first: party,
  second: party,
  declaredBy: id,
  startedTick: tick,
  endedTick: tick.nullable(),
});
const peaceMotion = z.object({
  id,
  layerId: id,
  proposedBy: id,
  proposingSide: z.union([z.literal(0), z.literal(1)]),
  proposedTick: tick,
  acceptedTick: tick.nullable(),
  acceptedBy: id.nullable(),
});
const levyResult = z.object({
  application: z.enum(["applied", "replay"]),
  attackId: id,
  campaignId: id,
  attackTroopsBefore: tick,
  intercepted: tick,
  remainingAttackingTroops: tick,
  contributions: z.array(z.object({ nationId: id, troopsDebited: tick })),
});
export const NationalWarStateSnapshotSchema = z.object({
  version: z.literal(1),
  wars: z.object({
    version: z.literal(1),
    layers: z.array(warLayer),
    motions: z.array(peaceMotion),
    lastTick: tick,
  }),
  levy: z.object({
    version: z.literal(1),
    allowances: z.array(
      z.object({
        key: z.string().min(1),
        contributorId: id,
        limit: tick,
        spent: tick,
      }),
    ),
    processed: z.array(
      z.object({
        attackId: id,
        campaignId: id,
        attackerId: id,
        defenderId: id,
        attackTroopsBefore: tick,
        result: levyResult,
      }),
    ),
  }),
});
export type NationalWarStateSnapshot = z.infer<
  typeof NationalWarStateSnapshotSchema
>;

export type NationalWarCommand =
  | {
      kind: "declare-national";
      warId: string;
      aggressorId: string;
      targetId: string;
    }
  | {
      kind: "declare-imperial";
      warId: string;
      aggressor: ConflictParty;
      target: ConflictParty;
    }
  | { kind: "propose-peace"; motionId: string; warId: string }
  | { kind: "accept-peace"; motionId: string };
/** Executions may additionally carry the policy epoch captured at admission. */
export type VersionedNationalWarCommand = NationalWarCommand & {
  readonly policyVersion?: number;
};

/** Read-only port for E2 attack acceptance and E3 authorized observation. */
export interface NationalWarAuthority {
  authorizeOffensiveAction(
    attackerId: string,
    targetId: string | null,
  ): boolean;
  atWar(a: string, b: string): boolean;
  snapshot(): NationalWarStateSnapshot;
}

/** Sole Game-owned mutable state holder; never hand either ledger to clients. */
export class NationalWarStateService {
  private readonly wars: WarLedger;
  private readonly levy: DefenseLevyLedger;
  readonly authority: Readonly<NationalWarAuthority>;

  constructor(
    private readonly politics: PoliticsPort,
    private readonly transactions: TroopDebitTransactionAdapter = {
      prepare: () => {
        throw new Error("NATIONAL levy: atomic troop debit not connected");
      },
    },
  ) {
    this.wars = new WarLedger(politics);
    this.levy = new DefenseLevyLedger(transactions);
    this.authority = Object.freeze({
      authorizeOffensiveAction: (attackerId: string, targetId: string | null) =>
        this.wars.authorizeOffensiveAction(attackerId, targetId),
      atWar: (a: string, b: string) => this.wars.atWar(a, b),
      snapshot: () => this.snapshot(),
    });
  }

  snapshot(): NationalWarStateSnapshot {
    return NationalWarStateSnapshotSchema.parse({
      version: 1,
      wars: this.wars.exportState(),
      levy: this.levy.exportState(),
    });
  }

  /** The only replay permission oracle is the SAME live canonical WarLedger. */
  mayReplayAsCurrentSovereign(
    actorId: string,
    command: NationalWarCommand,
  ): boolean {
    return this.wars.mayReplayAsCurrentSovereign(actorId, command);
  }

  retireEmpireWars(empireIds: readonly string[], tick: number): void {
    this.wars.retireEmpireWars(empireIds, tick);
  }

  assertAccessionCompatible(empireId: string, candidateId: string): void {
    this.wars.assertAccessionCompatible(empireId, candidateId);
  }

  /** Apply the policy after actual consent, without replacing original WAR. */
  escalateAccessionWars(empireId: string, candidateId: string, tick: number): string[] {
    return this.wars.escalateAccessionWars(empireId, candidateId, tick);
  }

  /** Validate BOTH ledgers before touching the live state. */
  restore(raw: unknown): void {
    const state = NationalWarStateSnapshotSchema.parse(raw);
    const probeWars = new WarLedger(this.politics);
    probeWars.restoreState(state.wars as ConflictLedgerState);
    const probeLevy = new DefenseLevyLedger(this.transactions);
    probeLevy.restoreState(state.levy as LevyLedgerState);
    this.wars.restoreState(probeWars.exportState());
    this.levy.restoreState(probeLevy.exportState());
  }

  /**
   * E2 must call only after AttackExecution accepts a real authorized attack.
   * E1's GameImpl verifies the live MDA, contributor identity and troop CAS.
   */
  interceptAcceptedAttacks(
    requests: readonly IncomingDefense[],
  ): DefenseResult[] {
    return this.levy.interceptAcceptedAttacks(requests);
  }

  perform(actorId: string, command: NationalWarCommand, tick: number): void {
    if (!Number.isSafeInteger(tick) || tick < 0)
      throw new Error("NATIONAL war: invalid engine tick");
    switch (command.kind) {
      case "declare-national":
        this.wars.declareNational(
          command.warId,
          actorId,
          command.aggressorId,
          command.targetId,
          tick,
        );
        break;
      case "declare-imperial":
        this.wars.declareImperial(
          command.warId,
          actorId,
          command.aggressor,
          command.target,
          tick,
        );
        break;
      case "propose-peace":
        this.wars.proposePeace(command.motionId, command.warId, actorId, tick);
        break;
      case "accept-peace":
        this.wars.acceptPeace(command.motionId, actorId, tick);
        break;
      default:
        throw new Error("NATIONAL war: unsupported political command");
    }
  }
}
