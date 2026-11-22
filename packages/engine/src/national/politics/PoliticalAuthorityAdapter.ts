/**
 * Read-only NATIONAL political authority over the conductor-owned live state.
 *
 * This object owns NO political data, snapshots, troop balances or war records.
 * Supply a callback which reads the currently authoritative M0 projection
 * (for example () => runtime.snapshot().politics). NEVER cache that snapshot:
 * accession, succession, elimination and restore must become visible instantly.
 *
 * D-003/004/006/007/009/010/012/013; SOV-01..07; COAL-01..07;
 * WAR-04/07. The public surface is structurally compatible with E2's
 * PoliticsPort without importing or modifying the unmerged conflict branch.
 */
import type { PlayerID } from "@openfront/engine-api/game/GameTypes";
import {
  lastSovereignVictory,
  viewPact,
  type LastSovereignResult,
  type PoliticsProjection,
} from "./sovereignty";

/** The same Game-owned recipient filter serves both humans and AI nations. */
export interface NationalRecipientDiplomacy {
  readonly pacts: readonly {
    readonly id: string;
    readonly kind: "NAP" | "MDA";
    readonly leaderId: string;
    readonly members: readonly string[];
    readonly terms?: {
      readonly admission: "leader" | "unanimous";
      readonly expulsion: "leader" | "unanimous" | "forbidden";
    };
    readonly invited: boolean;
    /** Only an incumbent member sees its pact's unaccepted invitees. */
    readonly pendingInvitees?: readonly string[];
  }[];
  readonly empireOffers: readonly {
    readonly empireId: string;
    readonly candidateId: string;
    readonly proposerId: string;
    readonly recipientId: string;
  }[];
}

export type NationalWarAction = "declare" | "peace";

/** A grant must come from future conductor-owned, persisted imperial policy. */
export type NationalDelegationReader = (
  memberId: PlayerID,
  action: NationalWarAction,
) => boolean | undefined;

/** M0 query contract: the only mutation entry point is still NationalRuntime. */
export interface NationalPoliticalAuthority {
  empireOf(id: PlayerID): string | null;
  emperorOf(empireId: string): PlayerID | null;
  membersOf(empireId: string): readonly PlayerID[];
  alive(id: PlayerID): boolean;
  protectedByTreaty(a: PlayerID, b: PlayerID): boolean;
  delegatedNationalWar(id: PlayerID, action: NationalWarAction): boolean;
  warPolicyVersionFor(id: PlayerID): number | null;
  checkLastSovereignVictory(): LastSovereignResult | null;
}

/**
 * The functions expected by E2's PoliticsPort; these are aliases of queries
 * against the SAME live M0 state, not another conflicting polity registry.
 */
export interface NationalConflictPoliticsPort {
  empireOf(nationId: PlayerID): string | null;
  emperorOf(empireId: string): PlayerID | null;
  membersOf(empireId: string): readonly PlayerID[];
  nationAlive(nationId: PlayerID): boolean;
  empireExists(empireId: string): boolean;
  mayDeclareNational(memberId: PlayerID): boolean;
  maySettleNational(memberId: PlayerID): boolean;
  warPolicyVersionFor(memberId: PlayerID): number | null;
  treatyProtects(attackerId: PlayerID, targetId: PlayerID): boolean;
}

function knownLiving(
  state: Readonly<PoliticsProjection>,
  id: PlayerID,
): boolean {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    state.nations.some((n) => n.id === id && n.alive)
  );
}

/**
 * No caller can register new nations or mutate political projection through
 * this adapter. A provider must be trusted engine code, not client data.
 */
export class PoliticalAuthorityAdapter
  implements NationalPoliticalAuthority, NationalConflictPoliticsPort
{
  constructor(
    private readonly readCurrent: () => Readonly<PoliticsProjection>,
    private readonly readDelegation?: NationalDelegationReader,
  ) {}

  /**
   * Whitelist only public pact rosters, own/member clauses and incoming
   * invitations. Never release other actors' terms, ballots or offers.
   * The Game-facing observation collector must validate its real principal.
   */
  recipientDiplomacy(observerId: PlayerID): NationalRecipientDiplomacy {
    const state = this.readCurrent();
    if (!knownLiving(state, observerId)) return { pacts: [], empireOffers: [] };
    const pacts = state.pacts
      .map((p) => {
        const publicPact = viewPact(state, p.id, observerId);
        const member = p.memberIds.includes(observerId);
        const pending = p.invitations.find((i) => i.targetId === observerId);
        const invited =
          pending !== undefined &&
          (p.terms.admission === "leader"
            ? p.administratorId !== null &&
              pending.approvedBy.includes(p.administratorId)
            : p.memberIds.every((id) => pending.approvedBy.includes(id)));
        return {
          id: publicPact.id,
          kind: publicPact.kind,
          leaderId: publicPact.administratorId ?? [...p.memberIds].sort()[0],
          members: [...publicPact.memberIds].sort(),
          ...(publicPact.terms === undefined
            ? {}
            : { terms: { ...publicPact.terms } }),
          invited,
          ...(member
            ? {
                pendingInvitees: p.invitations
                  .map((inv) => inv.targetId)
                  .sort(),
              }
            : {}),
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const empireOffers = state.accessionOffers
      .filter((offer) => offer.recipientId === observerId)
      .map((offer) => ({ ...offer }))
      .sort(
        (a, b) =>
          (a.empireId < b.empireId ? -1 : a.empireId > b.empireId ? 1 : 0) ||
          (a.candidateId < b.candidateId
            ? -1
            : a.candidateId > b.candidateId
              ? 1
              : 0),
      );
    return { pacts, empireOffers };
  }

  empireOf(id: PlayerID): string | null {
    const state = this.readCurrent();
    if (!knownLiving(state, id)) return null;
    return state.empires.find((e) => e.memberIds.includes(id))?.id ?? null;
  }

  emperorOf(empireId: string): PlayerID | null {
    const state = this.readCurrent();
    const found = state.empires.find((e) => e.id === empireId);
    return found && knownLiving(state, found.leaderId) ? found.leaderId : null;
  }

  membersOf(empireId: string): readonly PlayerID[] {
    const state = this.readCurrent();
    const found = state.empires.find((e) => e.id === empireId);
    if (!found) return [];
    // Return a new list: a caller cannot mutate the authoritative roster.
    return found.memberIds.filter((id) => knownLiving(state, id)).sort();
  }

  alive(id: PlayerID): boolean {
    return knownLiving(this.readCurrent(), id);
  }

  nationAlive(id: PlayerID): boolean {
    return this.alive(id);
  }

  empireExists(empireId: string): boolean {
    return this.emperorOf(empireId) !== null;
  }

  protectedByTreaty(a: PlayerID, b: PlayerID): boolean {
    const state = this.readCurrent();
    if (a === b || !knownLiving(state, a) || !knownLiving(state, b)) {
      return false;
    }
    // Imperial siblings are already protected by same-empire legality in E2;
    // this query tests only NAP/MDA legal protection before Betray.
    return state.pacts.some(
      (p) =>
        (p.kind === "NAP" || p.kind === "MDA") &&
        p.memberIds.includes(a) &&
        p.memberIds.includes(b),
    );
  }

  treatyProtects(a: PlayerID, b: PlayerID): boolean {
    return this.protectedByTreaty(a, b);
  }

  /**
   * Independent sovereigns control their own national diplomacy.
   * The emperor controls member national diplomacy through the E2 actor
   * authorization check, irrespective of a delegated member policy.
   * For subordinate members, undefined/false/absent imperial policy DENIES.
   */
  delegatedNationalWar(id: PlayerID, action: NationalWarAction): boolean {
    const state = this.readCurrent();
    if (!knownLiving(state, id)) return false;
    const empire = state.empires.find((e) => e.memberIds.includes(id));
    if (!empire || empire.leaderId === id) return true;
    return this.readDelegation?.(id, action) === true;
  }

  warPolicyVersionFor(id: PlayerID): number | null {
    const state = this.readCurrent();
    if (!knownLiving(state, id)) return null;
    const empire = state.empires.find((e) => e.memberIds.includes(id));
    return empire ? (empire.warPolicyVersion ?? 0) : null;
  }

  mayDeclareNational(id: PlayerID): boolean {
    return this.delegatedNationalWar(id, "declare");
  }

  maySettleNational(id: PlayerID): boolean {
    return this.delegatedNationalWar(id, "peace");
  }

  /**
   * A stricter actor-aware query for conductor command routing.
   * E2 handles this with its own requireNationalAuthority, using the same
   * membership and policy queries. This does not declare or settle a war.
   */
  authorizedNationalWarActor(
    actorId: PlayerID,
    subjectId: PlayerID,
    action: NationalWarAction,
  ): boolean {
    const state = this.readCurrent();
    if (!knownLiving(state, actorId) || !knownLiving(state, subjectId)) {
      return false;
    }
    const empire = state.empires.find((e) => e.memberIds.includes(subjectId));
    if (!empire) return actorId === subjectId;
    if (actorId === empire.leaderId) return true;
    return (
      actorId === subjectId && this.readDelegation?.(subjectId, action) === true
    );
  }

  checkLastSovereignVictory(): LastSovereignResult | null {
    const result = lastSovereignVictory(this.readCurrent());
    return result.resolved ? result : null;
  }
}
