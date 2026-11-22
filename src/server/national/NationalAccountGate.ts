import type { TokenPayload } from "@openfront/shared/ApiSchemas";

/** Account provider is stamped by trusted API; a signed guest (or Dev bare
 * persistentID) is not an authenticated human NATIONAL participant.
 * Worker must ALSO revalidate live /users/@me on join and reconnect.
 */
export function isNationalSignedInAccount(
  claims: TokenPayload | null,
): boolean {
  return (
    claims !== null &&
    typeof claims.sub === "string" &&
    claims.sub.length > 0 &&
    typeof claims.provider === "string" &&
    claims.provider.trim().length > 0 &&
    claims.provider !== "guest" &&
    claims.role !== "banned"
  );
}
