/** Stateless report ingestion. No scanner, command execution, or target access. */
export type Finding = {
  source: "zap" | "nuclei";
  rule: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  asset: string;
  remediation: string;
};
const levels = new Set(["critical", "high", "medium", "low", "info"]);
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 512): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").slice(0, max) : "";
}
function asset(value: unknown): string {
  try {
    const url = new URL(text(value, 2048));
    if (!["http:", "https:"].includes(url.protocol)) return "[non-web asset omitted]";
    // No credentials, paths, query strings or fragments leave the importer.
    return url.origin;
  } catch { return "[unspecified asset]"; }
}
function severity(value: unknown): Finding["severity"] {
  const s = text(value).toLowerCase();
  return levels.has(s) ? s as Finding["severity"] : "info";
}
export function normalizeReport(source: string, input: unknown): { findings: Finding[]; counts: Record<string, number>; note: string } {
  const findings: Finding[] = [];
  function add(f: Finding) {
    if (findings.length >= 2000) throw new Error("Report exceeds 2,000 findings.");
    findings.push(f);
  }
  if (source === "nuclei") {
    if (!Array.isArray(input)) throw new Error("Nuclei input must be a JSON array (convert JSONL first).");
    for (const item of input) {
      const row = obj(item), info = obj(row.info);
      add({ source, rule: text(row["template-id"]), title: text(info.name), severity: severity(info.severity),
        asset: asset(row["matched-at"] ?? row.host), remediation: text(info.remediation, 1500) });
    }
  } else if (source === "zap") {
    const report = obj(input);
    if (!Array.isArray(report.site)) throw new Error("ZAP input must contain a site array.");
    if (report.site.length > 2000) throw new Error("Too many sites.");
    for (const item of report.site) {
      const site = obj(item);
      if (!Array.isArray(site.alerts)) throw new Error("ZAP site must contain alerts.");
      for (const item of site.alerts) {
        const alert = obj(item);
        const risk = ({ "0": "info", "1": "low", "2": "medium", "3": "high" } as const)[String(alert.riskcode) as "0"] ?? "info";
        add({ source, rule: text(String(alert.pluginid ?? "")), title: text(alert.alert ?? alert.name),
          severity: risk, asset: asset(site["@name"]), remediation: text(alert.solution, 1500) });
      }
    }
  } else throw new Error("Supported report formats: zap, nuclei.");
  // Stable de-duplication within a source only. Similar titles are not proof of the same issue.
  const unique = [...new Map(findings.map(f => [JSON.stringify([f.source, f.rule, f.asset, f.title]), f])).values()];
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of unique) counts[f.severity]++;
  return { findings: unique, counts, note: "Imported observations, not verified vulnerabilities. Raw requests, responses, credentials and URL paths are omitted. Titles and remediation remain untrusted text and may contain sensitive information." };
}
