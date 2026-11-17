import { describe, expect, it } from "vitest";
import { verifyHardwareWebgl } from "../../../scripts/national-qa/gpu-attestation.mjs";

const reported = (unmaskedRenderer, overrides = {}) => ({
  webgl: {
    supported: true,
    renderer: "WebKit WebGL",
    unmaskedRenderer,
    unmaskedVendor: "GPU Vendor",
    contextLost: false,
    ...overrides,
  },
});

describe("NATIONAL R8 real hardware renderer attestation", () => {
  it.each([
    "ANGLE (NVIDIA GeForce RTX 4070, Vulkan)",
    "ANGLE (Apple M3, Metal)",
    "AMD Radeon RX 7900 XT",
    "Intel Iris Xe Graphics",
  ])("accepts independently reported hardware %s", (renderer) => {
    expect(verifyHardwareWebgl(reported(renderer)).accepted).toBe(true);
  });

  it.each([
    "ANGLE (Google SwiftShader Device (Subzero), Vulkan)",
    "llvmpipe (LLVM 18.1.8, 256 bits)",
    "Mesa softpipe",
    "Microsoft Basic Render Driver",
    "lavapipe Vulkan",
  ])("rejects software renderer %s", (renderer) => {
    expect(verifyHardwareWebgl(reported(renderer))).toMatchObject({
      accepted: false,
      reason: "SOFTWARE_RENDERER_FORBIDDEN",
    });
  });

  it("rejects no WebGL2, context lost, and unreported or generic renderer", () => {
    expect(verifyHardwareWebgl(null).accepted).toBe(false);
    expect(
      verifyHardwareWebgl(reported("NVIDIA", { supported: false })).accepted,
    ).toBe(false);
    expect(
      verifyHardwareWebgl(reported("NVIDIA", { contextLost: true })).accepted,
    ).toBe(false);
    expect(verifyHardwareWebgl(reported(null)).accepted).toBe(false);
    expect(verifyHardwareWebgl(reported("WebKit WebGL")).accepted).toBe(false);
  });
});
