/**
 * NATIONAL defensive levy adapter bound to ACTUAL authoritative PlayerImpl
 * balances. No per-contributor removeTroops or escrow/refund simulation.
 */
import type { Game } from "../../game/Game";
import { PlayerImpl } from "../../game/PlayerImpl";
import type {
  PreparedTroopDebits,
  TroopDebit,
  TroopDebitTransactionAdapter,
} from "./DefenseLevy";

export class PlayerTroopDebitAdapter implements TroopDebitTransactionAdapter {
  constructor(
    private readonly game: Game,
    /** Test-only: injected during preflight, NEVER after the first debit. */
    private readonly validateForTest?: (index: number, player: PlayerImpl) => void,
  ) {}

  prepare(debits: readonly TroopDebit[]): PreparedTroopDebits {
    const seen = new Set<string>();
    const plans = debits.map((debit) => {
      const nationId = debit.source.nationId;
      if (
        seen.has(nationId) ||
        !this.game.hasPlayer(nationId) ||
        !Number.isSafeInteger(debit.expectedBalance) ||
        !Number.isSafeInteger(debit.debit) ||
        debit.debit <= 0 ||
        !Number.isSafeInteger(debit.resultingBalance) ||
        debit.resultingBalance !== debit.expectedBalance - debit.debit
      )
        throw new Error("NATIONAL: invalid proposed troop transaction");
      seen.add(nationId);
      const actual = this.game.player(nationId);
      if (
        !(actual instanceof PlayerImpl) ||
        !actual.isAlive() ||
        actual.troops() !== debit.expectedBalance ||
        debit.source.troops() !== actual.troops()
      )
        throw new Error("NATIONAL: nonauthoritative or stale troop source");
      return {
        player: actual,
        expectedBalance: debit.expectedBalance,
        debit: debit.debit,
        resultingBalance: debit.resultingBalance,
      };
    });
    const approved = plans.map((plan) => ({
      nationId: plan.player.id(),
      troopsDebited: plan.debit,
    }));
    let finished = false;
    return {
      approved,
      discard: () => {
        if (!finished) finished = true;
      },
      commit: () => {
        if (finished) throw new Error("NATIONAL: transaction already finished");
        // All validation, BigInt conversion and fault injection live inside
        // this method's read-only preflight; the final write loop cannot throw.
        PlayerImpl.commitNationalTroopDebits(plans, this.validateForTest);
        finished = true;
      },
    };
  }
}
