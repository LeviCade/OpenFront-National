/**
 * R8 hardware release attestation. A WebGL2 context alone does not mean GPU.
 * Renderer inspection is advisory evidence, not an authenticity claim against
 * a malicious local machine. Never auto-replace a real driver with SwiftShader.
 */
const SOFTWARE =
  /swiftshader|llvmpipe|softpipe|softwar(?:e|er)|swrast|virgl|lavapipe|basic render driver|microsoft basic|mesa offscreen|google swiftshader/i;
const GENERIC =
  /^(webgl|webkit webgl|webgl 2\.0|angle|unknown|unavailable|none|n\/a)$/i;

export function verifyHardwareWebgl(capabilities) {
  const gl = capabilities?.webgl;
  const unmasked = gl?.unmaskedRenderer;
  const vendor = gl?.unmaskedVendor;
  const evidence = {
    supported: gl?.supported === true,
    unmaskedRenderer: typeof unmasked === "string" ? unmasked : null,
    unmaskedVendor: typeof vendor === "string" ? vendor : null,
    renderer: typeof gl?.renderer === "string" ? gl.renderer : null,
    contextLost: gl?.contextLost === true,
  };
  if (!evidence.supported || evidence.contextLost) {
    return { accepted: false, reason: "WEBGL2_UNAVAILABLE_OR_LOST", evidence };
  }
  if (
    !evidence.unmaskedRenderer?.trim() ||
    GENERIC.test(evidence.unmaskedRenderer.trim())
  ) {
    return { accepted: false, reason: "GPU_RENDERER_UNATTESTED", evidence };
  }
  const combined = [
    evidence.unmaskedRenderer,
    evidence.unmaskedVendor,
    evidence.renderer,
  ].join(" ");
  if (SOFTWARE.test(combined)) {
    return { accepted: false, reason: "SOFTWARE_RENDERER_FORBIDDEN", evidence };
  }
  return { accepted: true, reason: "HARDWARE_RENDERER_REPORTED", evidence };
}
