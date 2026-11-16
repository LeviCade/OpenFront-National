import { readFileSync } from "node:fs";

function summarize(path) {
  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    if (report.error) {
      return { path, status: "error", detail: report.error.summary ?? report.error.code };
    }
    const v = report.metadata?.vulnerabilities;
    return {
      path,
      status: "reported",
      total: v?.total ?? "not-reported",
      critical: v?.critical ?? "not-reported",
      high: v?.high ?? "not-reported",
      moderate: v?.moderate ?? "not-reported",
      low: v?.low ?? "not-reported",
      info: v?.info ?? "not-reported",
    };
  } catch (e) {
    return { path, status: "invalid-or-missing", detail: String(e) };
  }
}
for (const path of process.argv.slice(2)) {
  console.log(JSON.stringify(summarize(path)));
}
