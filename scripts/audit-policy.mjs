import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const ALLOWED_ADVISORY = "GHSA-vfj7-8cjw-p6xm";
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

function parseReport(raw, label) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    throw new Error(`${label} audit did not return valid JSON`);
  }
  if (report?.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) {
    throw new Error(`${label} audit result is incomplete or has an unsupported format`);
  }
  for (const severity of SEVERITIES) {
    if (!Number.isInteger(report.metadata.vulnerabilities[severity])) {
      throw new Error(`${label} audit is missing the ${severity} count`);
    }
  }
  const entries = Object.keys(report.vulnerabilities);
  const severityTotal = SEVERITIES.reduce((total, severity) => total + report.metadata.vulnerabilities[severity], 0);
  if (report.metadata.vulnerabilities.total !== entries.length || severityTotal !== entries.length) {
    throw new Error(`${label} audit totals do not match its vulnerability entries`);
  }
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    if (!entry || entry.name !== name || !SEVERITIES.includes(entry.severity) || !Array.isArray(entry.via)) {
      throw new Error(`${label} audit contains an incomplete vulnerability entry for ${name}`);
    }
  }
  return report;
}

export function evaluateAuditProcess({ status, signal, error, stdout, stderr = "" }, label) {
  if (error || signal || ![0, 1].includes(status)) {
    throw new Error(`${label} audit transport failed (status ${status ?? "none"}): ${error?.message ?? signal ?? stderr.trim()}`);
  }
  return parseReport(stdout, label);
}

function advisoryId(via) {
  if (!via || typeof via !== "object") return null;
  const match = typeof via.url === "string" && via.url.match(/GHSA-[\w-]+/i);
  return match?.[0]?.toLowerCase() ?? null;
}

export function enforcePolicy(fullReport, productionReport) {
  const production = parseReport(JSON.stringify(productionReport), "production");
  const full = parseReport(JSON.stringify(fullReport), "full");
  if (production.metadata.vulnerabilities.total !== 0) {
    throw new Error("Production audit must contain zero vulnerabilities");
  }

  const vulnerabilities = full.vulnerabilities;
  const memo = new Map();
  function derivesOnlyFromException(name, visiting = new Set()) {
    if (memo.has(name)) return memo.get(name);
    const entry = vulnerabilities[name];
    if (!entry || visiting.has(name) || !Array.isArray(entry.via) || entry.via.length === 0) return false;
    const next = new Set(visiting).add(name);
    const allowed = entry.via.every((via) => {
      if (typeof via === "string") return derivesOnlyFromException(via, next);
      return advisoryId(via) === ALLOWED_ADVISORY.toLowerCase();
    });
    memo.set(name, allowed);
    return allowed;
  }

  const rejected = Object.keys(vulnerabilities).filter((name) => !derivesOnlyFromException(name));
  if (rejected.length) throw new Error(`Full audit contains findings outside ${ALLOWED_ADVISORY}: ${rejected.join(", ")}`);

  const counts = full.metadata.vulnerabilities;
  console.log(`Full audit: ${counts.total} finding entries (low ${counts.low}, moderate ${counts.moderate}, high ${counts.high}, critical ${counts.critical}).`);
  if (counts.total) console.log(`Allowed development-only exception: ${ALLOWED_ADVISORY}.`);
  console.log("Production audit: 0 vulnerabilities.");
}

function runAudit(args, outputPath, label) {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["audit", ...args, "--json"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  writeFileSync(outputPath, result.stdout || "", "utf8");
  return evaluateAuditProcess(result, label);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    mkdirSync("audit-results", { recursive: true });
    const full = runAudit([], "audit-results/full.json", "full");
    const production = runAudit(["--omit=dev"], "audit-results/production.json", "production");
    enforcePolicy(full, production);
  } catch (error) {
    console.error(`Audit policy failed: ${error.message}`);
    process.exitCode = 1;
  }
}
