// The caller MUST obtain trusted context independently of the evidence producer.
// This module validates binding/semantics, not the provenance of operator trust.
import { createHash } from "node:crypto";
import { validateScreenshotPng } from "./png-evidence.mjs";
import { C4_MODES, validateJourney } from "./c4-journey-semantics.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const reject = (reason) => ({ accepted: false, reason, releaseCertified: false });
const matches = (bytes, expected) =>
  Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 4_000_000 &&
  /^[a-f0-9]{64}$/.test(expected ?? "") && digest(bytes) === expected;

export function verifyC4Lane({ mode, browserBytes, authorityBytes, screenshots, trusted }) {
  if (!trusted || !matches(browserBytes, trusted.browserSha256) ||
      !matches(authorityBytes, trusted.authoritySha256))
    return reject("INDEPENDENT_ARTIFACT_DIGEST_MISMATCH");
  let browser;
  let authority;
  try {
    browser = JSON.parse(browserBytes.toString("utf8"));
    authority = JSON.parse(authorityBytes.toString("utf8"));
  } catch {
    return reject("EVIDENCE_JSON_INVALID");
  }
  const semantic = validateJourney(mode, browser, authority, trusted);
  if (!semantic.accepted) return reject(semantic.reason);
  if (!(screenshots instanceof Map) || screenshots.size !== browser.transitions.length)
    return reject("SCREENSHOT_MANIFEST_INCOMPLETE");
  for (const stage of browser.transitions) {
    const actual = validateScreenshotPng(screenshots.get(stage.phase));
    if (!actual) return reject("SCREENSHOT_PNG_INVALID_" + stage.phase);
    if (actual.sha256 !== stage.screenshotSha256)
      return reject("SCREENSHOT_DIGEST_MISMATCH_" + stage.phase);
  }
  return { ...semantic, sourceSha: trusted.sourceSha, mode, releaseCertified: false };
}

// Physical signature validation itself belongs to E6's external verifier.
// This gate consumes its independently pinned result bytes, never guest booleans.
export function verifyC4Release({ lanes, trustedByMode, physicalBytes, trustedPhysicalSha256, sourceSha }) {
  if (!Array.isArray(lanes) || lanes.length !== C4_MODES.length ||
      new Set(lanes.map(l => l.mode)).size !== C4_MODES.length ||
      !C4_MODES.every(mode => lanes.some(l => l.mode === mode)))
    return reject("REQUIRED_RELEASE_LANE_MISSING_OR_DUPLICATE");
  for (const lane of lanes) {
    const trusted = trustedByMode?.[lane.mode];
    if (trusted?.sourceSha !== sourceSha) return reject("RELEASE_SOURCE_MISMATCH");
    const result = verifyC4Lane({ ...lane, trusted });
    if (!result.accepted) return reject(lane.mode + ":" + result.reason);
  }
  if (!matches(physicalBytes, trustedPhysicalSha256))
    return reject("INDEPENDENT_PHYSICAL_CHAIN_MISSING");
  let physical;
  try { physical = JSON.parse(physicalBytes.toString("utf8")); }
  catch { return reject("INDEPENDENT_PHYSICAL_CHAIN_INVALID"); }
  // Local registered accounts are useful functional evidence, not provider/human certification.
  if (trustedByMode["private-national"].authKind !== "external-provider")
    return reject("EXTERNAL_PROVIDER_AUTH_UNPROVEN");
  if (physical?.accepted !== true || physical.releaseCertified !== true ||
      physical.hostCleanupVerified !== true || physical.sourceSha !== sourceSha ||
      !Array.isArray(physical.modes) || physical.modes.length !== 4 ||
      !["national-desktop","national-mobile","legacy-desktop","legacy-mobile"].every(m => physical.modes.includes(m)))
    return reject("INDEPENDENT_PHYSICAL_CHAIN_INCOMPLETE");
  return { accepted: true, reason: "FIVE_LANES_AND_PHYSICAL_RESULT_CORRELATED", releaseCertified: false };
}
