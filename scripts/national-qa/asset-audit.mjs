#!/usr/bin/env node
/** Fail closed on missing known shell assets or an accidentally imported restricted tree. */
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

const required = [
  "LICENSE",
  "LICENSE-ASSETS",
  "LICENSING.md",
  "resources/LICENSE",
  "resources/images/NationalLogo.svg",
  "resources/images/NationalMark.svg",
  "resources/images/GameplayScreenshot.png",
  "resources/images/background.webp",
  "resources/icons/icon512_maskable.png",
  "resources/icons/icon512_rounded.png",
  "resources/manifest.json",
  "docs/upstream-licenses/PROPRIETARY-ASSET-LICENSE.txt",
];
const failed = [];
const records = [];
if (existsSync("proprietary")) {
  failed.push("restricted /proprietary content included in this fork");
}
for (const path of required) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    failed.push("missing required file: " + path);
    continue;
  }
  const bytes = readFileSync(path);
  records.push({
    path,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
if (existsSync("resources/manifest.json")) {
  const manifest = JSON.parse(readFileSync("resources/manifest.json", "utf8"));
  for (const icon of manifest.icons ?? []) {
    const name = "resources/" + icon.src.replace(/^[/]+/, "");
    if (!existsSync(name)) failed.push("missing manifest icon: " + name);
  }
}
if (existsSync("LICENSE-ASSETS")) {
  const text = readFileSync("LICENSE-ASSETS", "utf8");
  if (
    !text.includes("Creative Commons") ||
    !text.includes("All Rights Reserved")
  ) {
    failed.push("upstream mixed asset license notice missing");
  }
}
// Detect newly copied restricted files by name, NOT mere source references to
// an optional upstream directory. Source-code references require manual audit.
const noDistribute = [".mp3", ".flac", ".woff", ".woff2", ".ttf"];
const sample = [];
const provenance = [];
const pinned = JSON.parse(
  readFileSync("docs/release/c4-class2-media-provenance.json", "utf8"),
);
const expected = new Map(pinned.records.map((record) => [record.path, record]));
const seen = new Set();
if (expected.size !== pinned.records.length || expected.size !== 40) {
  failed.push("invalid pinned media inventory");
}
function scan(dir) {
  if (!existsSync(dir)) return;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, item.name);
    if (item.isDirectory()) {
      if (!["node_modules", ".git", "dist", "static"].includes(item.name))
        scan(p);
    } else if (noDistribute.some((suffix) => item.name.endsWith(suffix))) {
      sample.push(p);
      const bytes = readFileSync(p);
      const gitBlobSha1 = createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      const origin = expected.get(p);
      const identityMatches =
        origin?.gitBlobSha1 === gitBlobSha1 &&
        origin?.upstreamBlobSha1 === gitBlobSha1 &&
        origin?.bytes === bytes.length;
      if (!identityMatches) failed.push("unreviewed or changed media: " + p);
      seen.add(p);
      provenance.push({
        path: p,
        category: /[.](woff2?|ttf)$/i.test(p) ? "font" : "audio",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        resourceDirectoryLicense: "CC BY-SA 4.0 / resources/LICENSE",
        gitBlobSha1,
        pinnedIdentityMatches: identityMatches,
        pinnedUpstreamSource: origin?.source ?? null,
        independentOriginReview: "PENDING",
      });
    }
  }
}
scan("resources");
for (const path of expected.keys()) {
  if (!seen.has(path)) failed.push("pinned media missing: " + path);
}
const withheldMusic = pinned.withheldMusic.map(
  (name) => "sounds/music/" + name,
);
for (const path of withheldMusic) {
  if (existsSync(join("resources", path))) {
    failed.push("withheld music unexpectedly present: " + path);
  }
}
// Audit all literal game music paths rather than assuming they were copied
// from a restricted upstream package. Never auto-fetch proprietary music.
const musicSources = [
  "src/client/sound/SoundManager.ts",
  "src/client/sound/MenuMusic.ts",
  "src/client/sound/MusicAvailability.ts",
];
const musicCallSites = musicSources.flatMap((source) =>
  readFileSync(source, "utf8")
    .split(String.fromCharCode(10))
    .flatMap((line, index) =>
      Array.from(
        line.matchAll(/sounds[/]music[/][a-z0-9-]+[.]mp3/g),
        (match) => ({ source, line: index + 1, path: match[0] }),
      ),
    ),
);
const referencedMusic = [
  ...new Set(musicCallSites.map(({ path }) => path)),
].sort();
const missingMusic = referencedMusic.filter(
  (path) => !existsSync(join("resources", path)),
);
for (const path of referencedMusic) {
  if (withheldMusic.includes(path))
    failed.push("withheld music referenced: " + path);
}
const result = {
  gate: "known-shell-assets-and-restricted-subtree",
  status: failed.length ? "FAIL" : "PASS",
  checks: records,
  inventoryReviewRequired: sample.sort(),
  resourceMediaProvenance: provenance.sort((a, b) =>
    a.path.localeCompare(b.path),
  ),
  originReviewStatus: "PENDING",
  referencedMusic,
  withheldMusic,
  pinnedUpstreamSha: pinned.upstreamSha,
  pinnedIdentityMatches: provenance.filter((r) => r.pinnedIdentityMatches)
    .length,
  musicCallSites,
  missingMusic,
  publicReleaseReady:
    failed.length === 0 && missingMusic.length === 0 && provenance.length === 0,
  originReviewCounts: {
    fonts: provenance.filter((r) => r.category === "font").length,
    audio: provenance.filter((r) => r.category === "audio").length,
  },
  limitations: [
    "This is not a comprehensive third-party rights clearance.",
    "Referenced assets, network CDN content, fonts and sound playback require browser and manual origin review.",
  ],
  failures: failed,
};
mkdirSync("national-qa-artifacts", { recursive: true });
writeFileSync(
  "national-qa-artifacts/assets.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    status: result.status,
    checked: records.length,
    reviewInventory: sample.length,
    fontsPending: provenance.filter((r) => r.category === "font").length,
    audioPending: provenance.filter((r) => r.category === "audio").length,
    referencedMusic: referencedMusic.length,
    withheldMusic,
    pinnedIdentityMatches: result.pinnedIdentityMatches,
    missingMusic,
    failures: failed,
  }),
);
if (
  failed.length ||
  (process.argv.includes("--strict-release") &&
    (missingMusic.length || provenance.length))
)
  process.exitCode = 1;
