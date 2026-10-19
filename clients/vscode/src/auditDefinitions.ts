/**
 * Packaged audit definitions and the PURE audit domain rules — the half of G07 that
 * makes a "local audit" a local artifact instead of a server session.
 *
 * The definitions mirror the server registry (`api/src/application/tools/systemAudits.ts`)
 * as DATA — id, display metadata, source-review instructions, remediation granularity —
 * plus a definition version, so a run started from this package can name exactly which
 * definition produced its briefing and findings. The server remains the canonical
 * registry; this packaged copy is what lets an offline editor run the SAME audit without
 * a briefing round trip, and lets a later import reconcile by id + version.
 *
 * Also here, host-free on purpose:
 *
 *   • {@link buildLocalAuditBriefing} — briefing construction, mirroring the server
 *     `AuditRunner` wording for the local executor;
 *   • {@link validateAuditFindings} — the acceptance rules a submitted report must pass
 *     before it is persisted;
 *   • {@link findingFingerprint} — the SAME digest the server computes
 *     (`api/src/application/tools/auditRemediation.ts`), so a remediation ticket created
 *     locally and one created by the cloud share one identity and never duplicate.
 */

import { createHash } from "node:crypto";

/** Version of the packaged definition set; bump when any definition's content changes. */
export const AUDIT_DEFINITIONS_VERSION = 1;

export const FINDING_SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** One thing an audit run found in the code (mirrors the server's `AuditFinding`). */
export interface AuditFinding {
  title: string;
  detail?: string | null;
  severity?: FindingSeverity;
  location?: string | null;
  recommendation?: string | null;
}

/** A versioned, packaged audit definition — display metadata plus the review checklist. */
export interface LocalAuditDefinition {
  id: string;
  version: number;
  name: string;
  category: "governance" | "quality" | "delivery";
  icon: string;
  blurb: string;
  /** Source-review checklist shared by local and cloud executors. */
  instructions: string;
  /** One remediation ticket per finding, instead of a single bundled ticket. */
  ticketPerFinding?: boolean;
}

export const LOCAL_AUDIT_DEFINITIONS: readonly LocalAuditDefinition[] = [
  {
    id: "soc2-audit",
    version: 1,
    name: "SOC 2 Readiness Audit",
    category: "governance",
    icon: "🛡️",
    blurb: "Scans your repos and controls against the SOC 2 Common Criteria (CC1–CC9) and tells you exactly what to close next.",
    instructions: "Inspect access controls, authentication, authorization, tenant boundaries, secrets, logging, change controls, incident response and evidence supporting SOC 2 readiness. Distinguish missing evidence from a verified control failure. Cite concrete code or control records.",
  },
  {
    id: "architecture-analysis",
    version: 1,
    name: "Architecture Analysis",
    category: "quality",
    icon: "🏛️",
    blurb: "Rates design-principle adherence (DRY, SOLID, DDD, patterns) across your codebase.",
    instructions: "Call analyze_codebase to measure dependencies, cycles, duplication and unused-code candidates. The audit host saves its full snapshot for the visualizer automatically; do not reconstruct a graph from the returned summary. Report additional source-review findings normally. Analyzer findings are ticketed automatically. Inspect layer boundaries and coupling. Report unavailable analyzers as skipped; never invent a graph or claim a fix from missing output.",
  },
  {
    id: "quality-audit",
    version: 1,
    name: "Quality Audit",
    category: "quality",
    icon: "✅",
    blurb: "Checks testing, CI, and build-integrity signals across your repositories.",
    instructions: "Call analyze_codebase for measured dependency, duplication and unused-code data. Its pinned analyzers use npm cache; the audit host saves the full snapshot automatically. Do not reconstruct a snapshot from a summary or duplicate the automatically ticketed analyzer findings. Report additional source-review findings normally. Inspect existing scripts and run available typechecks, lint and tests. Verify unused candidates against dynamic entry points before recommending deletion. Report failed and skipped checks; do not invent clean results.",
  },
  {
    id: "pm-vision-audit",
    version: 1,
    name: "Product Vision & Roadmap Audit",
    category: "delivery",
    icon: "🧭",
    blurb: "Measures product direction: objectives, key results, roadmap, and a documented vision.",
    instructions: "Compare documented product vision, objectives, key results and roadmap against implemented behavior. Identify unsupported promises, missing acceptance criteria, unowned work and inconsistencies. Cite both the planning artifact and relevant implementation.",
  },
  {
    id: "privacy-compliance-audit",
    version: 1,
    name: "Compliance Audit Agent",
    category: "governance",
    icon: "⚖️",
    blurb: "Reviews connected GitHub source for privacy, AI, marketing, minor-safety, transfer, and accessibility readiness across US federal/state, EU/EEA, UK, Canada, Brazil, and Australia requirements.",
    instructions: "Determine applicable data flows and jurisdictions. Inspect consent, notices, deletion, export, retention, marketing preferences, minor safeguards, AI disclosure, accessibility and vendor transfers. Verify actual implementations and tests; do not infer compliance solely from file names. Distinguish legal applicability questions from verified implementation defects.",
    ticketPerFinding: true,
  },
];

/** The packaged definition for an audit id, when this VSIX ships it. */
export function getLocalAuditDefinition(id: string): LocalAuditDefinition | undefined {
  return LOCAL_AUDIT_DEFINITIONS.find((definition) => definition.id === id);
}

/**
 * The briefing a local audit run starts with — the same shape the server builds in
 * `AuditRunner.runAudit` for the local executor, minus the server session. The report
 * tool the run must call is `save_audit_findings`, the tool `auditToolCatalog` exposes.
 */
export function buildLocalAuditBriefing(
  definition: LocalAuditDefinition,
  args: { runId: string; projectId?: number; source?: Record<string, unknown> },
): string {
  return `${definition.name}: ${definition.blurb}\n${definition.instructions}\n`
    + `Audit: ${definition.id} (definition v${definition.version}). Run: ${args.runId}.${args.projectId != null ? ` Project: ${args.projectId}.` : ""}\n`
    + "Inspect the actual source and run the relevant available static checks and tests. Report evidence, source locations, recommendations, and skipped checks. "
    + "Audit only; do not modify source or open remediation PRs during this run. "
    + `When finished call save_audit_findings with runId "${args.runId}" and every finding. Report an empty array for a clean pass. `
    + "The platform creates remediation tickets. Do not create duplicate tickets yourself. "
    + "Audit the local workspace on disk, including local changes. Record the inspected files and any source changes during the audit. "
    + `Source context: ${JSON.stringify(args.source ?? {})}`;
}

/** Bounds so a runaway report cannot flood the local store; mirrors the tool schema's intent. */
export const MAX_AUDIT_FINDINGS = 200;
const MAX_FIELD_CHARS = 4_000;

const clip = (value: string): string =>
  value.length <= MAX_FIELD_CHARS ? value : `${value.slice(0, MAX_FIELD_CHARS - 1)}…`;

function optionalText(value: unknown): string | null | undefined {
  if (value == null) return value as null | undefined;
  return typeof value === "string" && value.trim() ? clip(value.trim()) : undefined;
}

/**
 * Validate and normalize a submitted report. Invalid entries are dropped with an error
 * each, never silently coerced — a finding that cannot name what and where it is would
 * file an untraceable remediation ticket.
 */
export function validateAuditFindings(raw: unknown): { findings: AuditFinding[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { findings: [], errors: ["findings must be an array"] };
  const findings: AuditFinding[] = [];
  for (const [index, entry] of raw.slice(0, MAX_AUDIT_FINDINGS).entries()) {
    if (!entry || typeof entry !== "object") {
      errors.push(`finding ${index}: not an object`);
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const title = optionalText(candidate.title);
    if (!title) {
      errors.push(`finding ${index}: a non-empty title is required`);
      continue;
    }
    const severity = FINDING_SEVERITIES.includes(candidate.severity as FindingSeverity)
      ? (candidate.severity as FindingSeverity)
      : undefined;
    if (candidate.severity != null && !severity) errors.push(`finding ${index}: unknown severity "${String(candidate.severity)}" — recorded as medium`);
    const detail = optionalText(candidate.detail);
    const location = optionalText(candidate.location);
    const recommendation = optionalText(candidate.recommendation);
    findings.push({
      title,
      severity: severity ?? "medium",
      ...(detail !== undefined ? { detail } : {}),
      ...(location !== undefined ? { location } : {}),
      ...(recommendation !== undefined ? { recommendation } : {}),
    });
  }
  if (raw.length > MAX_AUDIT_FINDINGS) errors.push(`findings capped at ${MAX_AUDIT_FINDINGS}; ${raw.length - MAX_AUDIT_FINDINGS} dropped`);
  return { findings, errors };
}

/**
 * The remediation identity of a finding — the SAME digest the server computes in
 * `auditRemediation.findingFingerprint` (SHA-256 over `[auditId, location without line
 * numbers, title]`, both text fields trimmed/lowercased/whitespace-collapsed), so local
 * and cloud remediations dedupe against each other on import.
 */
export function findingFingerprint(auditId: string, finding: Pick<AuditFinding, "title" | "location">): string {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const identity = [auditId, normalize(finding.location ?? "").replace(/:\d+(?::\d+)?$/, ""), normalize(finding.title)];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
