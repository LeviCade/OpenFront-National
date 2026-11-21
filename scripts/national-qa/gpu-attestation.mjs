/**
 * A Chrome renderer is not hardware attestation. Release acceptance requires
 * independently witnessed host/guest evidence signed outside the disposable
 * game/browser guest, bound to this exact source and CI invocation.
 *
 * Trust anchor: an Ed25519 public key provisioned by the release controller,
 * never supplied by the game or inferred from the proof itself.
 */
import { verify as verifySignature } from "node:crypto";

const SOFTWARE =
  /swiftshader|llvmpipe|softpipe|softwar(?:e|er)|swrast|lavapipe|basic render driver|microsoft basic|mesa offscreen|google swiftshader/i;
const GENERIC =
  /^(webgl|webkit webgl|webgl 2[.]0|angle|unknown|unavailable|none|n[/]a)$/i;
const PIXEL = [51, 102, 153, 255];
const isPixel = (value) =>
  Array.isArray(value) &&
  value.length === PIXEL.length &&
  PIXEL.every((component, index) => value[index] === component);
const reject = (reason, evidence) => ({ accepted: false, reason, evidence });
const text = (value) => (typeof value === "string" ? value.trim() : "");

export function verifyHardwareWebgl(capabilities, trust = {}) {
  const gl = capabilities?.webgl;
  const gl1 = capabilities?.webgl1;
  const evidence = {
    supported: gl?.supported === true,
    unmaskedRenderer: text(gl?.unmaskedRenderer) || null,
    unmaskedVendor: text(gl?.unmaskedVendor) || null,
    renderer: text(gl?.renderer) || null,
    contextLost: gl?.contextLost === true,
    webgl1: {
      supported: gl1?.supported === true,
      contextLost: gl1?.contextLost === true,
      unmaskedRenderer: text(gl1?.unmaskedRenderer) || null,
      shaderPixel: gl1?.shaderPixel ?? null,
    },
    webgl2ShaderPixel: gl?.shaderPixel ?? null,
  };
  if (
    !evidence.supported ||
    evidence.contextLost ||
    !evidence.webgl1.supported ||
    evidence.webgl1.contextLost
  ) {
    return reject("WEBGL_CONTEXT_UNAVAILABLE_OR_LOST", evidence);
  }
  if (
    !evidence.unmaskedRenderer ||
    GENERIC.test(evidence.unmaskedRenderer) ||
    !evidence.webgl1.unmaskedRenderer ||
    GENERIC.test(evidence.webgl1.unmaskedRenderer)
  ) {
    return reject("GPU_RENDERER_UNATTESTED", evidence);
  }
  const combined = [
    evidence.unmaskedRenderer,
    evidence.unmaskedVendor,
    evidence.renderer,
    evidence.webgl1.unmaskedRenderer,
    text(gl1?.unmaskedVendor),
  ].join(" ");
  if (SOFTWARE.test(combined)) {
    return reject("SOFTWARE_RENDERER_FORBIDDEN", evidence);
  }
  if (
    !isPixel(evidence.webgl1.shaderPixel) ||
    !isPixel(evidence.webgl2ShaderPixel)
  ) {
    return reject("WEBGL_SHADER_PROOF_FAILED", evidence);
  }

  const proof = trust.signedProof;
  const expected = trust.expected;
  if (
    !proof?.payload ||
    !text(proof.signature) ||
    !text(trust.trustedPublicKey) ||
    !expected
  ) {
    return reject("INDEPENDENT_HARDWARE_PROOF_MISSING", evidence);
  }
  if (
    !/^[a-f0-9]{40}$/i.test(text(expected.sourceSha)) ||
    !/^\d+$/.test(text(expected.runId)) ||
    !/^\d+$/.test(text(expected.runAttempt)) ||
    !text(expected.runnerName) ||
    !/^[a-f0-9]{64}$/i.test(text(expected.challenge))
  ) {
    return reject("HARDWARE_PROOF_RUN_CONTEXT_MISSING", evidence);
  }
  const p = proof.payload;
  if (
    p.version !== 1 ||
    p.sourceSha !== expected.sourceSha ||
    p.runId !== expected.runId ||
    p.runAttempt !== expected.runAttempt ||
    p.runnerName !== expected.runnerName ||
    p.challenge !== expected.challenge
  ) {
    return reject("HARDWARE_PROOF_RUN_BINDING_MISMATCH", evidence);
  }
  const now = trust.now ?? Date.now();
  if (
    !Number.isSafeInteger(p.issuedAtMs) ||
    !Number.isSafeInteger(p.expiresAtMs) ||
    p.issuedAtMs > now + 30_000 ||
    now - p.issuedAtMs > 120_000 ||
    p.expiresAtMs <= now ||
    p.expiresAtMs - p.issuedAtMs > 120_000
  ) {
    return reject("HARDWARE_PROOF_EXPIRED_OR_INVALID", evidence);
  }
  if (
    p.host?.physicallyVerified !== true ||
    p.host?.gpuAccessLeaseVerified !== true ||
    !text(p.host?.deviceVendorId) ||
    !text(p.host?.deviceId) ||
    !text(p.host?.driver) ||
    !text(p.host?.renderNode) ||
    p.guest?.hardwareBackedVerified !== true ||
    p.guest?.renderer !== evidence.unmaskedRenderer ||
    p.guest?.webgl1Renderer !== evidence.webgl1.unmaskedRenderer ||
    !isPixel(p.guest?.webgl1ShaderPixel) ||
    !isPixel(p.guest?.webgl2ShaderPixel)
  ) {
    return reject("HOST_GUEST_HARDWARE_EVIDENCE_INSUFFICIENT", evidence);
  }
  if (
    /virgl/i.test(combined) &&
    !(
      p.host.deviceVendorId === "8086" &&
      p.host.deviceId === "0412" &&
      p.host.driver === "i915" &&
      p.host.renderNode === "/dev/dri/renderD128" &&
      p.host.virtualization === "kvm" &&
      p.host.virglTransportVerified === true &&
      p.guest.backend === "virgl"
    )
  ) {
    return reject("VIRGL_HOST_CHAIN_UNVERIFIED", evidence);
  }
  // Never trust a public key embedded in the proof or supplied by page JS.
  // The release controller provides the trusted key out of band.
  try {
    const sig = Buffer.from(proof.signature, "base64");
    if (
      sig.length !== 64 ||
      !verifySignature(
        null,
        Buffer.from(JSON.stringify(p), "utf8"),
        trust.trustedPublicKey,
        sig,
      )
    ) {
      return reject("HARDWARE_PROOF_SIGNATURE_INVALID", evidence);
    }
  } catch {
    return reject("HARDWARE_PROOF_SIGNATURE_INVALID", evidence);
  }
  return {
    accepted: true,
    reason: /virgl/i.test(combined)
      ? "SIGNED_HOST_BACKED_VIRGL_VERIFIED"
      : "SIGNED_PHYSICAL_GPU_VERIFIED",
    evidence,
  };
}
