import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHardwareWebgl } from "../../../scripts/national-qa/gpu-attestation.mjs";

const pixel = [51, 102, 153, 255];
const intelVirgl =
  "ANGLE (Mesa, virgl (Mesa Intel(R) HD Graphics 4600 (HSW GT2)), OpenGL ES 3.2)";
const expected = {
  sourceSha: "a".repeat(40),
  runId: "44099988776",
  runAttempt: "1",
  runnerName: "skybot-ci-gpu-ephemeral",
  challenge: "b".repeat(64),
};

function browser(renderer = intelVirgl) {
  const gl = {
    supported: true,
    renderer: "WebKit WebGL",
    unmaskedRenderer: renderer,
    unmaskedVendor: "Mesa",
    contextLost: false,
    shaderPixel: pixel,
  };
  return { webgl: gl, webgl1: { ...gl } };
}

function witnessed(renderer = intelVirgl) {
  const keys = generateKeyPairSync("ed25519");
  const payload = {
    version: 1,
    ...expected,
    issuedAtMs: 1_800_000_000_000,
    expiresAtMs: 1_800_000_090_000,
    host: {
      physicallyVerified: true,
      gpuAccessLeaseVerified: true,
      deviceVendorId: "8086",
      deviceId: "0412",
      driver: "i915",
      renderNode: "/dev/dri/renderD128",
      virtualization: "kvm",
      virglTransportVerified: true,
    },
    guest: {
      hardwareBackedVerified: true,
      backend: "virgl",
      renderer,
      webgl1Renderer: renderer,
      webgl1ShaderPixel: pixel,
      webgl2ShaderPixel: pixel,
    },
  };
  const seal = () => ({
    payload,
    signature: sign(
      null,
      Buffer.from(JSON.stringify(payload)),
      keys.privateKey,
    ).toString("base64"),
  });
  return {
    payload,
    seal,
    options: {
      signedProof: seal(),
      trustedPublicKey: keys.publicKey.export({ format: "pem", type: "spki" }),
      expected,
      now: 1_800_000_005_000,
    },
  };
}

describe("NATIONAL signed hardware release attestation", () => {
  it("accepts only real separately signed Intel HD 4600 KVM/VirGL chain", () => {
    const evidence = witnessed();
    expect(verifyHardwareWebgl(browser(), evidence.options)).toMatchObject({
      accepted: true,
      reason: "SIGNED_HOST_BACKED_VIRGL_VERIFIED",
    });
  });

  it("does not trust a convincing renderer without independent signature", () => {
    expect(verifyHardwareWebgl(browser())).toMatchObject({
      accepted: false,
      reason: "INDEPENDENT_HARDWARE_PROOF_MISSING",
    });
    expect(
      verifyHardwareWebgl(browser("NVIDIA GeForce RTX 4070")),
    ).toMatchObject({
      accepted: false,
      reason: "INDEPENDENT_HARDWARE_PROOF_MISSING",
    });
  });

  it.each([
    "ANGLE (Google SwiftShader Device (Subzero), Vulkan)",
    "llvmpipe (LLVM 18.1.8, 256 bits)",
    "Mesa softpipe",
    "Microsoft Basic Render Driver",
    "lavapipe Vulkan",
    "software rasterizer",
  ])(
    "rejects forbidden software renderer regardless of proof: %s",
    (renderer) => {
      expect(
        verifyHardwareWebgl(browser(renderer), witnessed(renderer).options),
      ).toMatchObject({
        accepted: false,
        reason: "SOFTWARE_RENDERER_FORBIDDEN",
      });
    },
  );

  it("rejects missing/lost WebGL2 or WebGL1 and missing shaders", () => {
    const trust = witnessed().options;
    expect(verifyHardwareWebgl(null, trust).accepted).toBe(false);
    expect(
      verifyHardwareWebgl({ ...browser(), webgl1: null }, trust).accepted,
    ).toBe(false);
    expect(
      verifyHardwareWebgl(
        {
          ...browser(),
          webgl: { ...browser().webgl, contextLost: true },
        },
        trust,
      ).accepted,
    ).toBe(false);
    expect(
      verifyHardwareWebgl(
        {
          ...browser(),
          webgl1: { ...browser().webgl1, shaderPixel: null },
        },
        trust,
      ),
    ).toMatchObject({
      accepted: false,
      reason: "WEBGL_SHADER_PROOF_FAILED",
    });
    expect(verifyHardwareWebgl(browser("WebKit WebGL"), trust).accepted).toBe(
      false,
    );
  });

  it("rejects untrusted signatures, counterfeit keys and tampered witnesses", () => {
    const witness = witnessed();
    const forged = witnessed().options.signedProof;
    expect(
      verifyHardwareWebgl(browser(), {
        ...witness.options,
        signedProof: forged,
      }).accepted,
    ).toBe(false);
    witness.payload.guest.backend = "swiftshader";
    expect(verifyHardwareWebgl(browser(), witness.options).accepted).toBe(
      false,
    );
    witness.options.signedProof = witness.seal();
    expect(verifyHardwareWebgl(browser(), witness.options).accepted).toBe(
      false,
    );
  });

  it.each(["sourceSha", "runId", "runAttempt", "runnerName", "challenge"])(
    "rejects stale or replayed attestation for different %s",
    (field) => {
      const witness = witnessed();
      expect(
        verifyHardwareWebgl(browser(), {
          ...witness.options,
          expected: { ...expected, [field]: "wrong" },
        }).accepted,
      ).toBe(false);
    },
  );

  it("rejects expired witness and unverifiable physical GPU/virgl host", () => {
    const witness = witnessed();
    expect(
      verifyHardwareWebgl(browser(), {
        ...witness.options,
        now: 1_800_000_100_000,
      }),
    ).toMatchObject({
      accepted: false,
      reason: "HARDWARE_PROOF_EXPIRED_OR_INVALID",
    });
    witness.payload.host.physicallyVerified = false;
    witness.options.signedProof = witness.seal();
    expect(verifyHardwareWebgl(browser(), witness.options).accepted).toBe(
      false,
    );
    witness.payload.host.physicallyVerified = true;
    witness.payload.host.virglTransportVerified = false;
    witness.options.signedProof = witness.seal();
    expect(verifyHardwareWebgl(browser(), witness.options)).toMatchObject({
      accepted: false,
      reason: "VIRGL_HOST_CHAIN_UNVERIFIED",
    });
  });

  it("accepts independently signed physical non-VirGL devices", () => {
    const renderer = "ANGLE (NVIDIA GeForce RTX 4070, Vulkan)";
    const witness = witnessed(renderer);
    witness.payload.host = {
      physicallyVerified: true,
      gpuAccessLeaseVerified: true,
      deviceVendorId: "10de",
      deviceId: "2786",
      driver: "nvidia",
      renderNode: "/dev/dri/renderD129",
    };
    witness.payload.guest.backend = "direct";
    witness.options.signedProof = witness.seal();
    expect(
      verifyHardwareWebgl(browser(renderer), witness.options),
    ).toMatchObject({
      accepted: true,
      reason: "SIGNED_PHYSICAL_GPU_VERIFIED",
    });
  });
});
