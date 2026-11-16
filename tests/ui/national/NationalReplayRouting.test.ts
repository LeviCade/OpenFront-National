import { describe, expect, it } from "vitest";
import { VIEW_DATA_ROUTING } from "../../../src/client/replay/codec/FrameNormalizer";

describe("NATIONAL typed packet/replay compatibility", () => {
  it("requires explicit decisions for both E2 public packet fields", () => {
    // Old binary replay frames never encoded public politics or recipient-only
    // command receipts. Drop rather than invent past leadership or replay a
    // founding acknowledgement as if it were a new live action.
    expect(VIEW_DATA_ROUTING.nationalPolitics).toBe("dropped");
    expect(VIEW_DATA_ROUTING.nationalCommandResults).toBe("dropped");
  });

  it("does not change existing FFA tile, player, unit or event handling", () => {
    expect(VIEW_DATA_ROUTING.packedTileUpdates).toBe("normalizer");
    expect(VIEW_DATA_ROUTING.packedPlayerUpdates).toBe("normalizer");
    expect(VIEW_DATA_ROUTING.packedUnitUpdates).toBe("normalizer");
    expect(VIEW_DATA_ROUTING.packedNukeImpacts).toBe("events");
    expect(VIEW_DATA_ROUTING.tickExecutionDuration).toBe("dropped");
  });
});
