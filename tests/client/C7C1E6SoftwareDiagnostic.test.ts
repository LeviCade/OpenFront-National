// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { e6SoftwareDiagnosticAllowed } from "../../src/client/render/gl/initGL";

describe("C7C1E6 software diagnostic is not a release or remote bypass", () => {
  it("requires explicit opt-in, dev compilation and exact localhost origin", () => {
    expect(e6SoftwareDiagnosticAllowed(true, "1", "http://localhost:9000")).toBe(
      true,
    );
    for (const origin of [
      "https://localhost:9000",
      "http://localhost:9001",
      "http://127.0.0.1:9000",
      "http://localhost.attacker.invalid:9000",
      "https://openfront.io",
    ]) {
      expect(e6SoftwareDiagnosticAllowed(true, "1", origin)).toBe(false);
    }
    expect(e6SoftwareDiagnosticAllowed(false, "1", "http://localhost:9000")).toBe(
      false,
    );
    expect(e6SoftwareDiagnosticAllowed(true, "0", "http://localhost:9000")).toBe(
      false,
    );
    expect(
      e6SoftwareDiagnosticAllowed(true, undefined, "http://localhost:9000"),
    ).toBe(false);
  });
});
