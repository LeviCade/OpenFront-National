#!/usr/bin/env node
/**
 * Independent npm advisory inventory. A valid JSON npm-audit result is needed
 * even when npm exits 1 due to findings; network/API errors fail closed.
 * No package upgrade, --force, suppression or protected artifact transfer.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const levels = ["info", "low", "moderate", "high", "critical"];
const empty = () => ({
  info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0,
});

export function summarizeNpmAudit(json) {
  if (!json || typeof json !== "object" ||
      !json.metadata || typeof json.metadata !== "object" ||
      !json.metadata.vulnerabilities ||
      typeof json.metadata.vulnerabilities !== "object" ||
      !json.vulnerabilities || typeof json.vulnerabilities !== "object") {
    throw Error("AUDIT_JSON_INCOMPLETE");
  }
  const counts = {};
  for (const key of [...levels, "total"]) {
    const value = json.metadata.vulnerabilities[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw Error("AUDIT_VULNERABILITY_COUNT_INVALID: " + key);
    }
    counts[key] = value;
  }
  if (levels.reduce((n, key) => n + counts[key], 0) !== counts.total) {
    throw Error("AUDIT_SEVERITIES_DO_NOT_SUM");
  }
  const packages = Object.entries(json.vulnerabilities).map(([name, entry]) => {
    if (!entry || typeof entry !== "object" ||
        !levels.includes(entry.severity)) {
      throw Error("AUDIT_PACKAGE_SEVERITY_INVALID");
    }
    return {
      name: name.slice(0, 120),
      severity: entry.severity,
      direct: entry.isDirect === true,
      fixAvailable: entry.fixAvailable === true ||
        (entry.fixAvailable && typeof entry.fixAvailable === "object"),
    };
  });
  return { counts, packages: packages.sort((a,b) => a.name.localeCompare(b.name)) };
}

function invokeAudit(arguments_) {
  const result = spawnSync("npm", ["audit", "--json", ...arguments_], {
    encoding: "utf8", maxBuffer: 12 * 1024 * 1024,
  });
  if (result.error || !result.stdout) {
    throw Error("NPM_AUDIT_UNAVAILABLE");
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw Error("NPM_AUDIT_NON_JSON");
  }
  if (parsed.error || (result.status !== 0 && result.status !== 1)) {
    throw Error("NPM_AUDIT_REGISTRY_OR_PROCESS_FAILURE");
  }
  return summarizeNpmAudit(parsed);
}

export function compareDependencyRisk(production, full) {
  const productionNames = new Set(production.packages.map((x) => x.name));
  return {
    production,
    allInstalled: full,
    devOnlyCandidates: full.packages.filter((x) => !productionNames.has(x.name)),
    productionAdvisoriesZero: production.counts.total === 0,
    developmentReviewPending: full.counts.total > production.counts.total,
    publicReleaseSecurityCleared: false,
  };
}

function main() {
  mkdirSync("national-qa-artifacts", { recursive: true });
  let result;
  try {
    const prod = invokeAudit(["--omit=dev"]);
    const full = invokeAudit([]);
    result = { schema: 1, conclusive: true, ...compareDependencyRisk(prod, full) };
    process.exitCode = prod.counts.total > 0 ||
      (process.argv.includes("--strict-release") && full.counts.total > 0)
      ? 1 : 0;
  } catch (error) {
    result = {
      schema: 1, conclusive: false,
      errorCode: String(error.message ?? error).slice(0, 100),
      production: { counts: empty(), packages: [] },
      allInstalled: { counts: empty(), packages: [] },
      productionAdvisoriesZero: false,
      developmentReviewPending: true,
      publicReleaseSecurityCleared: false,
    };
    process.exitCode = 1;
  }
  writeFileSync(
    "national-qa-artifacts/dependencies.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify({
    conclusive: result.conclusive,
    production: result.production.counts,
    devCandidateCount: result.devOnlyCandidates?.length ?? null,
    devReviewPending: result.developmentReviewPending,
    errorCode: result.errorCode ?? null,
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
