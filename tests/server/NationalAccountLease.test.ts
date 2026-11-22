import type {
  TokenPayload,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { CloseCode, CloseReason } from "@openfront/shared/CloseCodes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jwt from "../../src/server/jwt";
import {
  NATIONAL_ACCOUNT_POLL_MS,
  watchNationalAccount,
} from "../../src/server/national/NationalAccountLease";

const ok = (publicId = "account-A", ban = false) => ({
  type: "success" as const,
  response: {
    player: { publicId },
    ban: ban ? { category: "game", reason: null, expiresAt: null } : null,
  } as UserMeResponse,
});
function lease(expiresIn = 100) {
  let current = true;
  let national = true;
  const disconnect = vi.fn();
  const stop = watchNationalAccount({
    token: "unit-only-token",
    claims: {
      sub: "subject-A",
      exp: Date.now() / 1000 + expiresIn,
    } as TokenPayload,
    publicId: "account-A",
    current: () => current,
    national: () => national,
    disconnect,
  });
  return {
    stop,
    disconnect,
    replace: () => {
      current = false;
    },
    legacy: () => {
      national = false;
    },
    national: () => {
      national = true;
    },
  };
}
describe("bounded physical-socket NATIONAL account lease", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("disconnects revoked active accounts after the next live API check", async () => {
    const lookup = vi
      .spyOn(jwt, "getUserMe")
      .mockResolvedValueOnce(ok())
      .mockResolvedValue({ type: "error", status: 401, message: "revoked" });
    const socket = lease();
    await vi.advanceTimersByTimeAsync(NATIONAL_ACCOUNT_POLL_MS);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(socket.disconnect).toHaveBeenCalledExactlyOnceWith(
      CloseCode.Unauthorized,
      CloseReason.InvalidToken,
    );
  });
  it("separates ban and transient outage from valid account recovery", async () => {
    const lookup = vi
      .spyOn(jwt, "getUserMe")
      .mockResolvedValue(ok("account-A", true));
    const banned = lease();
    await vi.advanceTimersByTimeAsync(0);
    expect(banned.disconnect).toHaveBeenCalledExactlyOnceWith(
      CloseCode.Banned,
      CloseReason.Banned,
    );
    lookup.mockResolvedValue({
      type: "error",
      status: 503,
      message: "unavailable",
    });
    const outage = lease();
    await vi.advanceTimersByTimeAsync(0);
    expect(outage.disconnect).toHaveBeenCalledExactlyOnceWith(
      CloseCode.TryAgainLater,
      CloseReason.AccountLookupFailed,
    );
    lookup.mockResolvedValue(ok());
    const recovered = lease();
    await vi.advanceTimersByTimeAsync(NATIONAL_ACCOUNT_POLL_MS);
    expect(recovered.disconnect).not.toHaveBeenCalled();
    recovered.stop();
  });
  it("expires even while an upstream lookup is unresolved", async () => {
    vi.spyOn(jwt, "getUserMe").mockImplementation(() => new Promise(() => {}));
    const socket = lease(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket.disconnect).toHaveBeenCalledExactlyOnceWith(
      CloseCode.TryAgainLater,
      CloseReason.InvalidToken,
    );
  });
  it("cannot revoke a replacement socket when an old asynchronous lookup resolves", async () => {
    let resolve!: (result: Awaited<ReturnType<typeof jwt.getUserMe>>) => void;
    vi.spyOn(jwt, "getUserMe")
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue(ok());
    const old = lease();
    old.replace();
    const next = lease();
    resolve({ type: "error", status: 401, message: "old revoked token" });
    await vi.advanceTimersByTimeAsync(NATIONAL_ACCOUNT_POLL_MS);
    expect(old.disconnect).not.toHaveBeenCalled();
    expect(next.disconnect).not.toHaveBeenCalled();
    next.stop();
  });
  it("denies linked-account public identity replacement", async () => {
    vi.spyOn(jwt, "getUserMe").mockResolvedValue(ok("different-public-id"));
    const socket = lease();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.disconnect).toHaveBeenCalledExactlyOnceWith(
      CloseCode.Unauthorized,
      CloseReason.InvalidToken,
    );
  });
});
