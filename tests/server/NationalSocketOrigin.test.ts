import { describe, expect, it } from "vitest";
import {
  LOCAL_NATIONAL_ORIGINS,
  matchesNationalSocketOrigin,
  nationalHostedSocketOrigins,
} from "../../src/server/national/NationalSocketOrigin";

describe("NATIONAL physical WebSocket Origin admission", () => {
  const hosted = nationalHostedSocketOrigins(
    "openfront.example",
    "blue.games.example",
    "blue.openfront.example",
  );

  it("accepts exactly own HTTPS page/game hosts and fixed app origin", () => {
    expect(hosted).toEqual([
      "app://openfront",
      "https://openfront.example",
      "https://blue.games.example",
      "https://blue.openfront.example",
    ]);
    for (const origin of hosted) {
      expect(matchesNationalSocketOrigin(origin, hosted)).toBe(true);
    }
  });

  it.each([
    undefined,
    "",
    "null",
    "http://openfront.example",
    "https://openfront.example.evil.test",
    "https://sibling.games.example",
    "https://replay.openfront.example",
    "https://evil.test",
    "https://openfront.example:443",
    "https://openfront.example,https://evil.test",
    " https://openfront.example",
    "https://openfront.example ",
    "wss://blue.games.example",
    "app://evil",
    "https://a".repeat(180),
  ])("rejects untrusted or ambiguous Origin %s", (origin) => {
    expect(matchesNationalSocketOrigin(origin, hosted)).toBe(false);
  });

  it("isolated localhost is never an authorized external hosted Origin", () => {
    for (const origin of LOCAL_NATIONAL_ORIGINS) {
      expect(matchesNationalSocketOrigin(origin, LOCAL_NATIONAL_ORIGINS)).toBe(
        true,
      );
      expect(matchesNationalSocketOrigin(origin, hosted)).toBe(false);
    }
    expect(
      matchesNationalSocketOrigin(
        "http://localhost:9000.attacker.invalid",
        LOCAL_NATIONAL_ORIGINS,
      ),
    ).toBe(false);
  });
});
