import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
import type { TokenPayload } from "@openfront/shared/ApiSchemas";
import { getUserMe } from "../jwt";

export const NATIONAL_ACCOUNT_POLL_MS = 10_000;

export interface NationalAccountLeaseOptions {
  token: string;
  claims: TokenPayload;
  publicId: string;
  current: () => boolean;
  national: () => boolean;
  disconnect: (code: CloseCode, reason: CloseReason) => void;
}

/**
 * Per physical socket, never per mutable Client. A successful account lookup
 * is a bounded lease, not everlasting match authority. Active NATIONAL checks
 * every 10 seconds + the account client's bounded 5-second network timeout.
 * At access expiry, reconnect with the client's existing fresh-token path.
 * A failure must not grant authority to an old socket or delete the seat.
 * Legacy Private FFA sockets are watched only for later NATIONAL opt-in;
 * they do not perform account I/O or lose authority while in legacy mode.
 */
export function watchNationalAccount(
  options: NationalAccountLeaseOptions,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const cutoff = options.claims.exp * 1000;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(expiry);
  };
  const disconnect = (code: CloseCode, reason: CloseReason) => {
    if (stopped) return;
    stop();
    if (options.current() && options.national()) options.disconnect(code, reason);
  };
  const expired = () => {
    if (!Number.isFinite(cutoff) || Date.now() >= cutoff) {
      // A browser's normal reconnect obtains a refreshed JWT. This closure
      // is retryable, not a terminal ban or an irreversible loss of ownership.
      disconnect(CloseCode.TryAgainLater, CloseReason.InvalidToken);
      return true;
    }
    return false;
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void check(), NATIONAL_ACCOUNT_POLL_MS);
    timer.unref();
  };
  const check = async () => {
    if (stopped || !options.current()) return stop();
    if (!options.national()) return schedule();
    if (expired()) return;
    if (expiry === undefined) {
      expiry = setTimeout(
        () => {
          expiry = undefined;
          if (options.national() && options.current()) expired();
        },
        Math.max(0, cutoff - Date.now()),
      );
      expiry.unref();
    }
    const account = await getUserMe(options.token);
    if (stopped || !options.current()) return stop();
    if (!options.national()) return schedule();
    if (expired()) return;
    if (account.type === "error") {
      const terminal = account.status === 401 || account.status === 403;
      return disconnect(
        terminal ? CloseCode.Unauthorized : CloseCode.TryAgainLater,
        terminal ? CloseReason.InvalidToken : CloseReason.AccountLookupFailed,
      );
    }
    if (account.response.ban) {
      return disconnect(CloseCode.Banned, CloseReason.Banned);
    }
    if (account.response.player.publicId !== options.publicId) {
      return disconnect(CloseCode.Unauthorized, CloseReason.InvalidToken);
    }
    schedule();
  };
  // Revalidated by Worker before admission; check immediately so a socket
  // entering from a legacy lobby gets the same lease and expiration policy.
  void check();
  return stop;
}
