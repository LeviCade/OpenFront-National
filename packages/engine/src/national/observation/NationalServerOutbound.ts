/**
 * Trusted-host NATIONAL outbound boundary. E2 owns the authoritative server
 * runner, socket authentication and delivery. This module accepts ONLY an E2
 * server-verified connection handle and an authoritative Game; it never
 * chooses an observer from an inbound browser payload.
 *
 * The old GameRunner/Worker projection is still needed for Solo, but cannot
 * defend a Private browser holding the entire Game. This interface is for a
 * future server-owned simulation, NOT a claim that multiplayer uses it yet.
 */
import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import type { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import type { ClientID } from "@openfront/engine-api/Schemas";
import type { Game, Player } from "../../game/Game";
import {
  persistNationalHumanSight,
  restoreNationalHumanSight,
} from "./HumanSightPersistence";
import { collectLiveNationalObservation } from "./LiveObservation";
import {
  NationalOutboundFilter,
  projectNationalAccessionOffers,
} from "./NationalOutbound";
import {
  actorNationalResults,
  emptyNationalResultDeliveryState,
  initialNationalResultDeliveryState,
  type NationalResultDeliveryState,
} from "./NationalPoliticalPacket";

/**
 * The host must supply a LIVE socket/roster binding created AFTER
 * authentication. Neither clientID nor these callbacks may be read from a
 * client message. Session handles are intentionally not reusable on reconnect.
 */
export interface TrustedNationalServerConnection {
  readonly clientID: ClientID | null;
  isConnected(): boolean;
  isSpectator(): boolean;
}

/** No Game, WAR/LEVY state, unit arrays, troop balances, treaty clauses,
 * fingerprints, intelligence cache or full GameSnapshot may cross this port.
 * All fields are rebuilt from authoritative E1 reads on each call.
 */
export type NationalServerPoliticalPacket = Pick<
  GameUpdateViewData,
  | "tick"
  | "nationalPolitics"
  | "nationalAccessionOffers"
  | "nationalCommandResults"
>;

/**
 * One instance per independently authenticated SERVER socket. Never cache
 * this on a match, share it across connections or instantiate in a browser.
 * E2 must own the actual server-side GameRunner and socket send operation.
 */
export class NationalServerRecipientSession {
  private readonly originalClientID: ClientID | null;
  private readonly principalId: string | null;
  private readonly outbound: NationalOutboundFilter;
  private receiptDelivery: NationalResultDeliveryState =
    emptyNationalResultDeliveryState();
  private closed = false;

  constructor(
    private readonly game: Game,
    private readonly connection: TrustedNationalServerConnection,
  ) {
    if (!game.config().nationalMode()) {
      throw new Error("NATIONAL trusted server projection in legacy mode");
    }
    this.originalClientID = connection.clientID;
    const player =
      connection.isConnected() &&
      !connection.isSpectator() &&
      this.originalClientID !== null
        ? game.playerByClientID(this.originalClientID)
        : null;
    // Capture a REAL registered principal once. A spectator or unknown
    // connection cannot acquire another player's rights by mutating its
    // session object later.
    this.principalId =
      player?.type() === PlayerType.Human ? player.id() : null;
    this.outbound = new NationalOutboundFilter(game, this.principalId);
    if (this.principalId !== null) {
      this.outbound.restoreSightMemory(
        restoreNationalHumanSight(game, this.principalId),
      );
      // Reconnecting users get current pending offers/roster, never old
      // private success toasts from before this independent session started.
      this.receiptDelivery = initialNationalResultDeliveryState(game, player!);
    }
  }

  /** A disconnected or changed-identity socket permanently loses its port.
   * A spectator can see public facts but can never elevate this session.
   */
  private currentPlayer(): Player | null {
    if (this.closed) return null;
    if (!this.connection.isConnected()) {
      this.close();
      return null;
    }
    if (this.connection.clientID !== this.originalClientID) {
      this.close();
      return null;
    }
    if (this.principalId === null) return null;
    if (this.connection.isSpectator()) {
      this.close();
      return null;
    }
    const player =
      this.originalClientID === null
        ? null
        : this.game.playerByClientID(this.originalClientID);
    if (!player || player.id() !== this.principalId ||
        player.type() !== PlayerType.Human) {
      this.close();
      return null;
    }
    return player.hasSpawned() && player.isAlive() ? player : null;
  }

  public close(): void {
    this.closed = true;
    this.outbound.restoreSightMemory(null);
    this.receiptDelivery = emptyNationalResultDeliveryState();
  }

  /**
   * A politics-only server wire, derived from the real Game every time.
   * This does NOT call JSON.stringify(Game) or use a browser-requested
   * observerId. E1 read paths remain the sole authority for all recipients.
   * Disconnected/revoked handles return null (no network emission).
   */
  public projectPolitics(): NationalServerPoliticalPacket | null {
    const actor = this.currentPlayer();
    if (this.closed) return null;
    const publicView = this.game.nationalPublicPoliticalView();
    if (publicView === null) {
      throw new Error("NATIONAL server is missing authoritative politics");
    }
    const political: NationalServerPoliticalPacket = {
      tick: this.game.ticks(),
      nationalPolitics: {
        empires: publicView.empires.map((empire) => ({
          id: empire.id,
          leaderId: empire.leaderId,
          memberIds: [...empire.memberIds],
        })),
        warnings: publicView.warnings.map((warning) => ({
          empireId: warning.empireId,
          deadlineMs: warning.deadlineMs,
          remainingMs: warning.remainingMs,
          blockedByAssetDisposition: warning.blockedByAssetDisposition,
        })),
        victory:
          publicView.victory === null
            ? null
            : {
                sovereignPowerCount: publicView.victory.sovereignPowerCount,
                resolved: publicView.victory.resolved,
                prizes: publicView.victory.prizes.map((prize) =>
                  prize.kind === "SovereignVictor"
                    ? { kind: prize.kind, nationId: prize.nationId }
                    : {
                        kind: prize.kind,
                        nationId: prize.nationId,
                        empireId: prize.empireId,
                      },
                ),
              },
      },
    };
    // Suppress all private fields for spectators, unknown clients, dead or
    // pre-spawn players; an empty offer list for an active human is meaningful
    // and must be present to invalidate stale UI action state.
    if (actor === null) return political;
    const offers = projectNationalAccessionOffers(this.game, actor.id());
    const results = actorNationalResults(
      this.game,
      actor,
      this.receiptDelivery,
    );
    return {
      ...political,
      ...(offers === undefined ? {} : { nationalAccessionOffers: offers }),
      ...(results.length === 0 ? {} : { nationalCommandResults: results }),
    };
  }

  /**
   * Optional map/units channel for E2's trusted GameRunner-produced frame.
   * Drop ALL client-supplied or stale politics/results and rebuild them from
   * E1; then apply existing E3 sight/asset/player whitelist. The source frame
   * must be produced on the HOST, never accepted from a browser socket.
   */
  public projectGameUpdate(
    authoritativeFrame: GameUpdateViewData,
  ): GameUpdateViewData | null {
    if (authoritativeFrame.tick !== this.game.ticks()) {
      throw new Error("NATIONAL stale/mismatched server frame");
    }
    const packet = this.projectPolitics();
    if (packet === null) return null;
    const actor = this.currentPlayer();
    if (this.closed) return null;
    const verified =
      actor === null ? null : collectLiveNationalObservation(this.game, actor.id());
    const selected = {
      ...authoritativeFrame,
      nationalPolitics: packet.nationalPolitics,
      nationalCommandResults: packet.nationalCommandResults,
      nationalAccessionOffers: packet.nationalAccessionOffers,
    };
    const outbound = this.outbound.project(this.game, selected, verified);
    if (actor !== null) {
      persistNationalHumanSight(
        this.game,
        actor.id(),
        this.outbound.snapshotSightMemory(),
      );
    }
    return outbound;
  }
}
