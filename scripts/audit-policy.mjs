import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const ALLOWED_ADVISORY = "GHSA-vfj7-8cjw-p6xm";
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseReport(raw, label) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    throw new Error(`${label} audit did not return valid JSON`);
  }
  if (!isRecord(report) || Object.hasOwn(report, "error")) {
    throw new Error(`${label} audit returned an explicit error or invalid payload`);
  }
  if (
    report.auditReportVersion !== 2 ||
    !isRecord(report.vulnerabilities) ||
    !isRecord(report.metadata) ||
    !isRecord(report.metadata.vulnerabilities)
  ) {
    throw new Error(`${label} audit result is incomplete or has an unsupported format`);
  }
  const counters = report.metadata.vulnerabilities;
  for (const counter of [...SEVERITIES, "total"]) {
    if (!Number.isSafeInteger(counters[counter]) || counters[counter] < 0) {
      throw new Error(`${label} audit has an invalid ${counter} count`);
    }
  }
  const entries = Object.keys(report.vulnerabilities);
  const severityTotal = SEVERITIES.reduce((total, severity) => total + counters[severity], 0);
  if (counters.total !== entries.length || severityTotal !== entries.length) {
    throw new Error(`${label} audit totals do not match its vulnerability entries`);
  }
  const actualCounts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    if (
      !isRecord(entry) ||
      entry.name !== name ||
      !SEVERITIES.includes(entry.severity) ||
      typeof entry.isDirect !== "boolean" ||
      !Array.isArray(entry.via) ||
      entry.via.length === 0 ||
      !Array.isArray(entry.effects) ||
      typeof entry.range !== "string" ||
      !Array.isArray(entry.nodes) ||
      entry.nodes.length === 0 ||
      !Object.hasOwn(entry, "fixAvailable")
    ) {
      throw new Error(`${label} audit contains an incomplete vulnerability entry for ${name}`);
    }
    actualCounts[entry.severity] += 1;
    for (const via of entry.via) {
      if (typeof via === "string") {
        if (!via || !Object.hasOwn(report.vulnerabilities, via)) {
          throw new Error(`${label} audit contains an unresolved via reference from ${name}`);
        }
      } else if (
        !isRecord(via) ||
        (typeof via.source !== "number" && typeof via.source !== "string") ||
        typeof via.name !== "string" ||
        !via.name ||
        !SEVERITIES.includes(via.severity) ||
        typeof via.url !== "string" ||
        !via.url
      ) {
        throw new Error(`${label} audit contains malformed advisory metadata for ${name}`);
      }
    }
  }
  for (const severity of SEVERITIES) {
    if (counters[severity] !== actualCounts[severity]) {
      throw new Error(`${label} audit ${severity} count does not match its vulnerability entries`);
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

function compatibleFix(entry, name) {
  const fix = entry.fixAvailable;
  if (fix === false) return false;
  if (fix === true) return true;
  if (
    !isRecord(fix) ||
    typeof fix.name !== "string" ||
    !fix.name ||
    typeof fix.version !== "string" ||
    !fix.version ||
    typeof fix.isSemVerMajor !== "boolean"
  ) {
    throw new Error(`Full audit contains malformed remediation metadata for ${name}`);
  }
  return fix.isSemVerMajor === false;
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

  const remediable = Object.entries(vulnerabilities)
    .filter(([name, entry]) => compatibleFix(entry, name))
    .map(([name]) => name);
  if (remediable.length) {
    throw new Error(`A compatible remediation is available for ${remediable.join(", ")}; update the reviewed dependency baseline and remove the ${ALLOWED_ADVISORY} exception`);
  }

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
