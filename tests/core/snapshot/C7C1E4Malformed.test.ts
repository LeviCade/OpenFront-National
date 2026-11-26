import {
  readVersioned,
  snapshotType,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { decodeSnapshotValue } from "@openfront/engine/snapshot/SnapshotCodec";
import { z } from "zod";

describe("C7C1 E4 malformed snapshot records", () => {
  test("rejects duplicate object keys rather than selecting the last authority", () => {
    // Object(2), new string "a", true, string ref 0, false.
    expect(() =>
      decodeSnapshotValue(Uint8Array.of(11, 2, 8, 1, 97, 3, 9, 0, 2)),
    ).toThrow(/duplicate object key/);
  });

  test("rejects impossible container sizes before allocating", () => {
    expect(() => decodeSnapshotValue(Uint8Array.of(10, 127))).toThrow(
      /truncated array/,
    );
    expect(() => decodeSnapshotValue(Uint8Array.of(11, 127))).toThrow(
      /truncated object/,
    );
  });

  test("rejects nonpositive and future record versions", () => {
    const record = snapshotType({
      name: "Authority",
      version: 1,
      schema: z.object({}),
    });
    for (const v of [-1, 0, 2]) {
      expect(() => readVersioned(record, { v, d: {} })).toThrow();
    }
  });
});
