import { GameType, PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { NationalSettlementView } from "@openfront/engine-api/game/NationalSettlementView";
import {
  type ClientID,
  NationalIssueSanctionIntentSchema,
  NationalRespondSanctionIntentSchema,
  NationalResolveSanctionIntentSchema,
  NationalOfferSanctionSettlementIntentSchema,
  NationalDecideSanctionSettlementIntentSchema,
} from "@openfront/engine-api/Schemas";
import { zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import type { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { NationalUltimatumExecution } from "./NationalUltimatumExecution";

const commandSchema = z.discriminatedUnion("type", [
  NationalIssueSanctionIntentSchema,
  NationalRespondSanctionIntentSchema,
  NationalResolveSanctionIntentSchema,
  NationalOfferSanctionSettlementIntentSchema,
  NationalDecideSanctionSettlementIntentSchema,
]);
type Command = z.infer<typeof commandSchema>;
const phaseSchema = z.enum([
  "pending",
  "decision-required",
  "satisfied",
  "enforced",
  "backed-down",
  "expired",
]);
// Sanctions can release only Player entries they independently created.
// A null creation tick means an independent manual embargo pre-existed.
const sanctionEnforcementSchema = z.object({
  authorityId: z.string(),
  authorityVersion: z.number().int().nonnegative().nullable(),
  owners: z
    .array(
      z.object({
        id: z.string(),
        createdAt: z.number().int().nonnegative().nullable(),
      }),
    )
    .max(64),
  offer: z
    .object({
      requestId: z.string(),
      gold: z.string().regex(/^[1-9][0-9]{0,17}$/),
      offeredAt: z.number().int().nonnegative(),
      expiresAt: z.number().int().nonnegative(),
      status: z.enum(["pending", "accepted", "refused", "expired"]),
    })
    .nullable(),
});
const recipientSchema = z.object({
  id: z.string(),
  response: z.enum(["none", "comply", "refuse"]),
  noncompliant: z.boolean(),
  // Only actual paid external trade events; no private balance snapshots.
  continuedTrade: z.boolean(),
  // Optional to migrate earlier version-one sanctioned demands.
  enforcement: sanctionEnforcementSchema.optional(),
  // Append-only optional observation; legacy snapshots have no voyage witness.
  lastPaidCommerce: z.object({
    tick: z.number().int().nonnegative(),
    counterpartyId: z.string(),
    grossGold: z.string().regex(/^[1-9][0-9]{0,127}$/),
  }).optional(),
});
const demandSchema = z.object({
  id: z.string(),
  issuer: z.string(),
  empire: z.string().nullable(),
  target: z.string(),
  recipients: z.array(recipientSchema).min(1).max(16),
  deadline: z.number().int().nonnegative(),
  phase: phaseSchema,
  trigger: z.literal("continuing-trade"),
  threat: z.literal("embargo"),
});
type Demand = z.infer<typeof demandSchema>;
const stateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  actor: zPlayerRef(),
  command: commandSchema,
  clientId: z.string().nullable(),
  demand: demandSchema.nullable(),
});
type State = z.infer<typeof stateSchema>;

// Provisional OPEN 13 tuning, not constitutional law. Retaining terminal
// records prevents duplicate issuance and makes explicit retreat observable.
const MAX_DEMANDS = 128;
const MAX_PER_ISSUER = 16;
const RESOLUTION_WINDOW = 300;
const SETTLEMENT_WINDOW = 120;

function living(game: Game, id: string): Player | null {
  if (!game.hasPlayer(id)) return null;
  const p = game.player(id);
  return p.isAlive() && p.hasSpawned() ? p : null;
}

export function validEconomicActor(
  game: Game,
  actor: Player,
  clientId: ClientID | null,
): boolean {
  if (
    game.nationalWarAuthority() === null ||
    game.inSpawnPhase() ||
    living(game, actor.id()) !== actor
  ) {
    return false;
  }
  if (clientId !== null) {
    return (
      actor.type() === PlayerType.Human &&
      actor.clientID() === clientId &&
      game.playerByClientID(clientId) === actor
    );
  }
  return (
    actor.type() !== PlayerType.Human ||
    game.config().gameConfig().gameType !== GameType.Private
  );
}

/**
 * Durable demands are active deterministic executions, not a second trade
 * policy ledger: only the real Player.addEmbargo mutates actual permission.
 * Terminal records are bounded and retained for replay/idempotency.
 */
export class NationalSanctionExecution implements Execution {
  private active = true;
  private game: Game | null = null;
  private demand: Demand | null = null;

  constructor(
    private actor: Player,
    private command: Command,
    private clientId: ClientID | null = null,
  ) {}

  init(game: Game): void {
    this.game = game;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private static records(game: Game): NationalSanctionExecution[] {
    return game
      .executions()
      .filter(
        (e): e is NationalSanctionExecution =>
          e instanceof NationalSanctionExecution && e.demand !== null,
      );
  }

  private controllingIssuer(): Player | null {
    const game = this.game!;
    const d = this.demand!;
    const politics = game.nationalPoliticalAuthority();
    if (!politics) return null;
    if (d.empire !== null) {
      const emperor = politics.emperorOf(d.empire);
      return emperor === null ? null : living(game, emperor);
    }
    return politics.empireOf(d.issuer) === null ? living(game, d.issuer) : null;
  }

  private recipient(id: string): Player | null {
    return living(this.game!, id);
  }

  /** An outsider's demand does not itself delegate imperial economic authority. */
  private mayRespond(actor: Player, expectedVersion?: number): boolean {
    const game = this.game!;
    const empire = game.nationalPoliticalAuthority()?.empireOf(actor.id());
    if (empire === undefined) return false;
    if (empire === null) return expectedVersion === undefined; // no stale imperial grant after collapse
    const charter = game.nationalEconomicCharterFor(actor);
    return (
      charter !== null &&
      charter.empireId === empire &&
      charter.ownerId === charter.emperorId &&
      charter.delegated &&
      expectedVersion === charter.version
    );
  }

  private canApplyMemberRestriction(member: Player, target: Player): boolean {
    const game = this.game!;
    const p = game.nationalPoliticalAuthority();
    const empire = p?.empireOf(member.id());
    if (empire === null) return true;
    if (empire === undefined) return false;
    const charter = game.nationalEconomicCharterFor(member);
    return (
      charter !== null &&
      charter.ownerId === charter.emperorId &&
      (p?.empireOf(target.id()) !== empire || charter.allowInternal)
    );
  }

  private advance(tick: number): void {
    const d = this.demand!;
    const game = this.game!;
    for (const row of d.recipients) {
      const offer = row.enforcement?.offer;
      if (offer?.status === "pending" && tick >= offer.expiresAt)
        offer.status = "expired";
    }
    if (d.phase !== "pending" && d.phase !== "decision-required") return;
    const issuer = this.controllingIssuer();
    const target = living(game, d.target);
    // Accession, dissolution and elimination cannot produce new internal
    // sanctions or leave an expired issuer with authority.
    if (
      !issuer ||
      !target ||
      issuer === target ||
      (d.empire !== null &&
        game.nationalPoliticalAuthority()?.empireOf(d.target) === d.empire)
    ) {
      d.phase = "expired";
      return;
    }
    if (d.phase === "pending" && tick >= d.deadline) {
      for (const row of d.recipients) {
        const p = this.recipient(row.id);
        row.noncompliant =
          p !== null && (p.canTrade(target) || row.continuedTrade);
      }
      d.phase = d.recipients.some((row) => row.noncompliant)
        ? "decision-required"
        : "satisfied";
    }
    if (
      d.phase === "decision-required" &&
      tick >= d.deadline + RESOLUTION_WINDOW
    ) {
      d.phase = "expired";
    }
  }

  private issue(
    command: Extract<Command, { type: "national_issue_sanction" }>,
    tick: number,
  ): void {
    const game = this.game!;
    const politics = game.nationalPoliticalAuthority()!;
    const actor = this.actor.id();
    const empire = politics.empireOf(actor);
    if (
      (command.scope === "national" && empire !== null) ||
      (command.scope === "imperial" &&
        (empire === null || politics.emperorOf(empire) !== actor))
    )
      return;
    const target = living(game, command.targetId);
    if (
      !target ||
      target === this.actor ||
      (empire !== null && politics.empireOf(target.id()) === empire)
    )
      return;
    const ids = [...new Set(command.recipientIds)].sort();
    if (
      ids.length !== command.recipientIds.length ||
      ids.some(
        (id) =>
          id === actor ||
          id === target.id() ||
          (empire !== null && politics.empireOf(id) === empire) ||
          living(game, id) === null,
      )
    )
      return;
    const records = NationalSanctionExecution.records(game);
    const scopeRecords = records.filter((e) =>
      empire !== null
        ? e.demand!.empire === empire
        : e.demand!.empire === null && e.demand!.issuer === actor,
    );
    if (
      records.length >= MAX_DEMANDS ||
      scopeRecords.length >= MAX_PER_ISSUER ||
      records.some(
        (e) =>
          e.actor.id() === actor && e.command.requestId === command.requestId,
      )
    )
      return;
    const ordinal = game.executions().indexOf(this);
    if (ordinal < 0) return;
    const id = `sanction-${tick}-${this.actor.smallID()}-${ordinal}`;
    if (records.some((e) => e.demand!.id === id)) return;
    this.demand = {
      id,
      issuer: actor,
      empire: command.scope === "imperial" ? empire : null,
      target: target.id(),
      recipients: ids.map((id) => ({
        id,
        response: "none",
        noncompliant: false,
        continuedTrade: false,
      })),
      deadline: tick + command.durationTicks,
      phase: "pending",
      trigger: "continuing-trade",
      threat: "embargo",
    };
    this.active = true;
  }

  private respond(
    actor: Player,
    decision: "comply" | "refuse",
    expectedVersion?: number,
  ): void {
    const d = this.demand!;
    if (
      d.phase !== "pending" ||
      this.recipient(actor.id()) !== actor ||
      !this.mayRespond(actor, expectedVersion)
    )
      return;
    const row = d.recipients.find((r) => r.id === actor.id());
    const target = living(this.game!, d.target);
    if (
      !row ||
      !target ||
      row.response !== "none" ||
      !this.canApplyMemberRestriction(actor, target)
    )
      return;
    if (decision === "comply") actor.addEmbargo(target, false);
    row.response = decision;
  }

  /** Emperor-only centralized response; validated against the current crown
   * and CAS epoch at the actual Game execution boundary. */
  static emperorRespond(
    game: Game,
    emperor: Player,
    memberId: string,
    sanctionId: string,
    decision: "comply" | "refuse",
    empireId: string,
    expectedVersion: number,
    advanceEpoch: () => void,
  ): void {
    const auth = game.nationalPoliticalAuthority();
    const member = living(game, memberId);
    const charter = member && game.nationalEconomicCharterFor(member);
    if (
      !auth ||
      auth.emperorOf(empireId) !== emperor.id() ||
      !member ||
      auth.empireOf(memberId) !== empireId ||
      !charter ||
      charter.version !== expectedVersion ||
      (charter.ownerId !== null && charter.ownerId !== emperor.id())
    )
      throw new Error("NATIONAL: unauthorized imperial sanction response");
    const record = this.records(game).find((e) => e.demand?.id === sanctionId);
    const d = record?.demand;
    const row = d?.recipients.find((r) => r.id === memberId);
    const target = d && living(game, d.target);
    if (
      !record ||
      !d ||
      d.phase !== "pending" ||
      !row ||
      row.response !== "none" ||
      !target ||
      !record.controllingIssuer() ||
      (auth.empireOf(target.id()) === empireId && !charter.allowInternal)
    )
      throw new Error("NATIONAL: ineligible imperial sanction demand");
    if (decision === "comply") member.addEmbargo(target, false);
    row.response = decision;
    advanceEpoch();
  }

  private resolve(actor: Player, decision: "enforce" | "back-down"): void {
    const d = this.demand!;
    const game = this.game!;
    if (d.phase !== "decision-required" || this.controllingIssuer() !== actor)
      return;
    if (decision === "back-down") {
      d.phase = "backed-down";
      return;
    }
    const owners =
      d.empire === null
        ? [actor]
        : (game.nationalPoliticalAuthority()?.membersOf(d.empire) ?? [])
            .map((id) => living(game, id))
            .filter((p): p is Player => p !== null);
    let imposed = false;
    for (const row of d.recipients) {
      if (!row.noncompliant) continue;
      const recipient = this.recipient(row.id);
      if (
        !recipient ||
        (d.empire !== null &&
          game.nationalPoliticalAuthority()?.empireOf(recipient.id()) ===
            d.empire)
      )
        continue;
      const enforcement: z.infer<typeof sanctionEnforcementSchema> = {
        authorityId: actor.id(),
        authorityVersion:
          d.empire === null
            ? null
            : (game
                .nationalPoliticalAuthority()
                ?.warPolicyVersionFor(actor.id()) ?? null),
        owners: [],
        offer: null,
      };
      for (const owner of owners) {
        if (owner === recipient) continue;
        const existing = owner.hasManualEmbargoAgainst(recipient);
        owner.addEmbargo(recipient, false);
        const entry = owner
          .getEmbargoes()
          .find((item) => item.target === recipient && !item.isTemporary);
        enforcement.owners.push({
          id: owner.id(),
          createdAt: existing ? null : (entry?.createdAt ?? null),
        });
        imposed = true;
      }
      if (enforcement.owners.length > 0) row.enforcement = enforcement;
    }
    d.phase = imposed ? "enforced" : "expired";
  }

  /** Fail closed when another sovereign or sanction also owns this pair. */
  private settlementOwners(row: Demand["recipients"][number]): Player[] | null {
    const game = this.game!;
    const d = this.demand!;
    const proof = row.enforcement;
    const target = this.recipient(row.id);
    const issuer = this.controllingIssuer();
    if (
      d.phase !== "enforced" ||
      !proof ||
      !target ||
      !issuer ||
      proof.authorityId !== issuer.id() ||
      proof.owners.length === 0 ||
      (d.empire !== null &&
        (proof.authorityVersion === null ||
          game
            .nationalPoliticalAuthority()
            ?.warPolicyVersionFor(issuer.id()) !== proof.authorityVersion ||
          game.nationalPoliticalAuthority()?.empireOf(target.id()) ===
            d.empire))
    )
      return null;
    const owners: Player[] = [];
    for (const claim of proof.owners) {
      const owner = living(game, claim.id);
      const entry = owner
        ?.getEmbargoes()
        .find((embargo) => embargo.target === target && !embargo.isTemporary);
      if (
        !owner ||
        claim.createdAt === null ||
        !entry ||
        entry.createdAt !== claim.createdAt ||
        target.hasManualEmbargoAgainst(owner) ||
        game.nationalWarAuthority()?.atWar(owner.id(), target.id()) ||
        NationalUltimatumExecution.hasEnforcedEmbargoPair(
          game,
          owner.id(),
          target.id(),
        )
      )
        return null;
      const overlap = NationalSanctionExecution.records(game).some((other) => {
        if (other === this || other.demand?.phase !== "enforced") return false;
        const competing = other.demand?.recipients.find(
          (candidate) => candidate.id === row.id,
        )?.enforcement;
        return (
          competing?.offer?.status !== "accepted" &&
          competing?.owners.some((record) => record.id === owner.id())
        );
      });
      if (overlap) return null;
      owners.push(owner);
    }
    return owners;
  }

  /** The embargoed recipient offers actual gold; no escrow or advance debit. */
  private offerSettlement(
    actor: Player,
    command: Extract<Command, { type: "national_offer_sanction_settlement" }>,
    tick: number,
  ): void {
    const row = this.demand!.recipients.find(
      (candidate) => candidate.id === actor.id(),
    );
    if (
      !row ||
      row.enforcement?.offer !== null ||
      this.recipient(actor.id()) !== actor ||
      !this.settlementOwners(row) ||
      BigInt(command.amountGold) > actor.gold() ||
      NationalSanctionExecution.records(this.game!).some((record) =>
        record.demand?.recipients.some(
          (candidate) =>
            candidate.enforcement?.offer?.requestId === command.requestId,
        ),
      )
    )
      return;
    row.enforcement!.offer = {
      requestId: command.requestId,
      gold: command.amountGold,
      offeredAt: tick,
      expiresAt: tick + SETTLEMENT_WINDOW,
      status: "pending",
    };
  }

  /** Only the exact currently controlling and original enforcing issuer decides. */
  private decideSettlement(
    actor: Player,
    command: Extract<Command, { type: "national_decide_sanction_settlement" }>,
    tick: number,
  ): void {
    const row = this.demand!.recipients.find(
      (candidate) => candidate.id === command.recipientId,
    );
    const offer = row?.enforcement?.offer;
    if (
      !row ||
      !offer ||
      offer.requestId !== command.offerId ||
      offer.status !== "pending" ||
      this.controllingIssuer() !== actor
    )
      return;
    if (tick >= offer.expiresAt) {
      offer.status = "expired";
      return;
    }
    if (command.decision === "refuse") {
      offer.status = "refused";
      return;
    }
    const payer = this.recipient(row.id);
    const owners = this.settlementOwners(row);
    const gold = BigInt(offer.gold);
    if (!payer || !owners || payer.gold() < gold) return;
    const paid = payer.removeGold(gold);
    if (paid !== gold) {
      payer.addGold(paid);
      return;
    }
    actor.addGold(paid);
    for (const owner of owners) owner.stopEmbargo(payer);
    offer.status = "accepted";
  }

  tick(tick: number): void {
    if (this.demand !== null) {
      this.advance(tick);
      return;
    }
    this.active = false;
    const game = this.game;
    if (!game || !validEconomicActor(game, this.actor, this.clientId)) return;
    const parsed = commandSchema.safeParse(this.command);
    if (!parsed.success) return;
    const command = parsed.data;
    if (command.type === "national_issue_sanction") {
      this.issue(command, tick);
      return;
    }
    const record = NationalSanctionExecution.records(game).find(
      (e) => e.demand!.id === command.sanctionId,
    );
    if (!record) return;
    record.advance(tick);
    if (command.type === "national_respond_sanction") {
      record.respond(
        this.actor,
        command.decision,
        command.expectedCharterVersion,
      );
    } else if (command.type === "national_resolve_sanction") {
      record.resolve(this.actor, command.decision);
    } else if (command.type === "national_offer_sanction_settlement") {
      record.offerSettlement(this.actor, command, tick);
    } else {
      record.decideSettlement(this.actor, command, tick);
    }
  }

  /** Canonical demand state participates in NATIONAL replay hash. */
  static stateHash(game: Game): number {
    const records = this.records(game);
    if (records.length === 0) return 0;
    return simpleHash(
      JSON.stringify(
        records.map((e) => ({
          demand: e.demand,
          requestId: e.command.requestId,
        })),
      ),
    );
  }

  /** Host-only read; projection must bind the real authenticated observer. */
  static viewFor(game: Game, observer: Player) {
    if (living(game, observer.id()) !== observer) return [];
    return this.records(game).flatMap((e) => {
      const d = e.demand!;
      const auth = game.nationalPoliticalAuthority();
      const isIssuer = e.controllingIssuer() === observer;
      const visible = d.recipients.filter((row) => {
        if (row.id === observer.id()) return true;
        const empire = auth?.empireOf(row.id);
        return (
          empire !== null &&
          empire !== undefined &&
          auth?.emperorOf(empire) === observer.id()
        );
      });
      if (!isIssuer && visible.length === 0) return [];
      return (isIssuer ? [null] : visible).map((own) => ({
        id: d.id,
        issuer: d.issuer,
        authorityId: e.controllingIssuer()?.id() ?? null,
        empire: d.empire,
        role: isIssuer
          ? ("issuer" as const)
          : own?.id === observer.id()
            ? ("recipient" as const)
            : ("recipient-emperor" as const),
        recipientId: own?.id ?? null,
        charterVersion: own
          ? (game.nationalEconomicCharterFor(game.player(own.id))?.version ??
            null)
          : null,
        canRespond:
          own?.id === observer.id() &&
          e.mayRespond(
            observer,
            game.nationalEconomicCharterFor(observer)?.version,
          ),
        recipientIds: isIssuer ? d.recipients.map((row) => row.id) : [own!.id],
        target: d.target,
        deadline: d.deadline,
        phase: d.phase,
        trigger: d.trigger,
        threat: d.threat,
        // Never expose a third party's offer to unrelated recipients.
        settlements: isIssuer
          ? d.recipients.flatMap((row) =>
              row.enforcement?.offer
                ? [{ recipientId: row.id, ...row.enforcement.offer }]
                : [],
            )
          : own?.enforcement?.offer
            ? [{ recipientId: own.id, ...own.enforcement.offer }]
            : [],
        response: own?.response ?? null,
        requestId:
          isIssuer &&
          e.actor === observer &&
          (e.clientId === null || e.clientId === observer.clientID())
            ? e.command.requestId
            : null,
      }));
    });
  }

  /**
   * E1 proposed read-only projection hook; the Conductor must merge this
   * method into E3's causal-ledger implementation without replacing E3.
   * Never authorize payment from a legacy unjournaled manual pair.
   */
  static settlementViewFor(
    game: Game,
    observer: Player,
    tick: number,
    streamId?: string,
  ): NationalSettlementView | undefined {
    if (
      !game.config().nationalMode() ||
      living(game, observer.id()) !== observer ||
      tick !== game.ticks()
    )
      return undefined;
    const items: NationalSettlementView["items"] = [];
    for (const execution of this.records(game)) {
      const demand = execution.demand!;
      if (demand.phase !== "enforced") continue;
      const issuer = execution.controllingIssuer();
      if (!issuer) continue;
      for (const row of demand.recipients) {
        const payer = execution.recipient(row.id);
        const proof = row.enforcement;
        if (!payer || !proof || issuer === payer) continue;
        const isIssuer = issuer === observer;
        if (!isIssuer && payer !== observer) continue;
        const offer = proof.offer;
        // The inherited v2 ledger cannot distinguish an idempotent manual
        // reassertion. Require actual E3 causal records for every owner.
        const owners = execution.settlementOwners(row);
        const causal = owners !== null && owners.every((owner) => {
          const entry = owner.getEmbargoes().find(
            (candidate) => candidate.target === payer && !candidate.isTemporary,
          );
          return entry !== undefined &&
            "reasons" in entry &&
            Array.isArray(entry.reasons) &&
            entry.reasons.includes("sanction:" + demand.id);
        });
        const pending = offer?.status === "pending" && offer.expiresAt > tick;
        const canOffer = !isIssuer && offer === null && causal && payer.gold() > 0n;
        const canAccept =
          isIssuer && pending && causal && payer.gold() >= BigInt(offer.gold);
        const canRefuse = isIssuer && pending;
        if (!offer && !canOffer && isIssuer) continue;
        const tradePermitted = proof.owners.length > 0 && proof.owners.every(
          (claim) => {
            const owner = living(game, claim.id);
            return owner !== null && owner.canTrade(payer) && payer.canTrade(owner);
          },
        );
        items.push({
          sanctionId: demand.id,
          payerId: payer.id(),
          issuerId: issuer.id(),
          role: isIssuer ? "issuer" : "payer",
          canOffer,
          canAccept,
          canRefuse,
          tradePermitted,
          lastPaidCommerce: offer?.status === "accepted" && row.lastPaidCommerce &&
            row.lastPaidCommerce.tick >= offer.offeredAt && row.lastPaidCommerce.tick <= tick &&
            proof.owners.some((claim) => claim.id === row.lastPaidCommerce?.counterpartyId)
            ? { ...row.lastPaidCommerce }
            : null,
          offer: offer === null ? null : {
            requestId: offer.requestId,
            gold: offer.gold,
            offeredAt: offer.offeredAt,
            expiresAt: offer.expiresAt,
            status: offer.status === "pending" && offer.expiresAt <= tick
              ? "expired"
              : offer.status,
          },
        });
      }
    }
    if (items.length === 0) return undefined;
    return {
      version: 1,
      recipientId: observer.id(),
      tick,
      paidMaritimeGold: observer.tradeGold().toString(),
      ...(streamId === undefined ? {} : { streamId }),
      items,
    };
  }

  /** Trusted payout hook: only a real completed external trade event. */
  static paidTrade(game: Game, a: Player, b: Player, grossGold?: bigint): void {
    if (game.nationalWarAuthority() === null || a === b) return;
    for (const e of this.records(game)) {
      const d = e.demand!;
      // This is a bounded last-voyage witness, never a payment instruction.
      // TradeShipExecution calls the hook only after its real paid arrival.
      // Capture only the exact former embargo pair, after accepted settlement.
      if (grossGold !== undefined && grossGold > 0n && d.phase === "enforced" &&
        a.canTrade(b) && b.canTrade(a)) {
        for (const row of d.recipients) {
          const proof = row.enforcement;
          if (proof?.offer?.status !== "accepted") continue;
          const counterparty = row.id === a.id() ? b.id() : row.id === b.id() ? a.id() : null;
          if (counterparty === null || !proof.owners.some((claim) => claim.id === counterparty)) continue;
          row.lastPaidCommerce = {
            tick: game.ticks(),
            counterpartyId: counterparty,
            grossGold: grossGold.toString(),
          };
        }
      }
      // No grace-period transaction is a violation. Deadline evaluation uses
      // live permission, with actual post-deadline transactions as evidence.
      if (game.ticks() < d.deadline) continue;
      e.advance(game.ticks());
      if (
        (d.phase !== "decision-required" && d.phase !== "satisfied") ||
        game.ticks() >= d.deadline + RESOLUTION_WINDOW
      )
        continue;
      const issuer = e.controllingIssuer();
      const target = living(game, d.target);
      if (
        !issuer ||
        !target ||
        issuer === target ||
        (d.empire !== null &&
          game.nationalPoliticalAuthority()?.empireOf(d.target) === d.empire)
      )
        continue;
      const other =
        d.target === a.id() ? b.id() : d.target === b.id() ? a.id() : null;
      const row = d.recipients.find((r) => r.id === other);
      if (row && e.recipient(row.id)) {
        row.continuedTrade = true;
        row.noncompliant = true;
        d.phase = "decision-required";
      }
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return NationalSanctionExecutionSnapshot.write({
      active: this.active,
      initialized: this.game !== null,
      actor: w.player(this.actor),
      command: commandSchema.parse(this.command),
      clientId: this.clientId,
      demand: this.demand,
    });
  }

  restoreSnapshot(s: State, r: SnapshotReader): void {
    this.active = s.active;
    this.game = s.initialized ? r.game : null;
    this.actor = r.player(s.actor);
    this.command = s.command;
    this.clientId = s.clientId;
    this.demand = s.demand;
  }
}

// Backward-compatible issuer/recipient DTO. Third-Class member-only fields
// are optional for existing NATIONAL economic AI fixture producers.
type ProjectedEconomicDemand = ReturnType<
  typeof NationalSanctionExecution.viewFor
>[number];
export type NationalEconomicDemandView = Omit<
  ProjectedEconomicDemand,
  "recipientId" | "charterVersion" | "canRespond" | "settlements"
> & {
  recipientId?: string | null;
  charterVersion?: number | null;
  canRespond?: boolean;
  settlements?: ProjectedEconomicDemand["settlements"];
};

export const NationalSanctionExecutionSnapshot = execSnapshotType({
  name: "NationalSanction",
  version: 2,
  migrations: { 1: (data) => data },
  schema: stateSchema,
  cls: () => NationalSanctionExecution,
});
