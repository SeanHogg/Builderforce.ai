/**
 * System-audit registry — the "one framework" for system-level audits, built ON
 * TOP of the generic Diagnostics & Tools engine (not beside it). Each audit is a
 * data object binding a diagnostic id to: its display metadata, a deterministic
 * `scan` (pure, always available), and the agent workflow that runs the deep
 * remediation pass. Adding an audit = one entry here; it then flows through
 * `recordExternalRun` → per-project rating → tenant rollup → `ToolResultView`
 * with no new tables, routes, or pages.
 */
import type { ToolCategory, ToolResult } from './toolTypes';
import { ARCHITECTURE_DIAGNOSTIC_ID, SOC2_AUDIT_ID, QUALITY_AUDIT_ID, PM_VISION_AUDIT_ID, PRIVACY_AUDIT_ID, EXTERNAL_DIAGNOSTIC_ICONS } from './auditIds';
import { soc2Scan, architectureScan, qualityScan, pmVisionScan, privacyScan, type AuditScanContext } from './auditScanners';

/** The agent workflow the deep audit dispatches — matches a key in the
 *  agent-runtime WORKFLOW_REGISTRY (node-orchestration-tools). `architecture`
 *  runs via the durable AnalysisRunnerDO instead of an orchestrate workflow. */
export type AuditAgentWorkflow = 'security_audit' | 'architecture' | 'quality_audit' | 'pm_vision_audit' | 'privacy_audit';

export interface SystemAudit {
  /** Diagnostic id — also the `tool_runs.tool_id` these runs are stored under. */
  id: string;
  name: string;
  /** Category on the shared ToolCategory axis (drives grouping/colour). */
  category: ToolCategory;
  icon: string;
  /** One-line "what this audits". */
  blurb: string;
  /** Source-review checklist shared by local and cloud executors. */
  instructions: string;
  /** Which agent workflow runs the deep pass when a run can be dispatched. */
  agentWorkflow: AuditAgentWorkflow;
  /** File ONE remediation ticket per gap (each recommendation), instead of a single
   *  bundled ticket — so every obligation is independently assigned + resolved,
   *  matching the Security agent's per-finding model. */
  ticketPerFinding?: boolean;
  /** Deterministic scan — the instant report + score backstop. */
  scan: (ctx: AuditScanContext) => ToolResult;
}

export const SYSTEM_AUDITS: SystemAudit[] = [
  {
    id: SOC2_AUDIT_ID,
    name: 'SOC 2 Readiness Audit',
    category: 'governance',
    icon: EXTERNAL_DIAGNOSTIC_ICONS[SOC2_AUDIT_ID]!,
    blurb: 'Scans your repos and controls against the SOC 2 Common Criteria (CC1–CC9) and tells you exactly what to close next.',
    agentWorkflow: 'security_audit',
    instructions: 'Inspect access controls, authentication, authorization, tenant boundaries, secrets, logging, change controls, incident response and evidence supporting SOC 2 readiness. Distinguish missing evidence from a verified control failure. Cite concrete code or control records.',
    scan: soc2Scan,
  },
  {
    id: ARCHITECTURE_DIAGNOSTIC_ID,
    name: 'Architecture Analysis',
    category: 'quality',
    icon: EXTERNAL_DIAGNOSTIC_ICONS[ARCHITECTURE_DIAGNOSTIC_ID]!,
    blurb: 'Rates design-principle adherence (DRY, SOLID, DDD, patterns) across your codebase.',
    agentWorkflow: 'architecture',
    instructions: 'Call analyze_codebase to measure dependencies, cycles, duplication and unused-code candidates. The audit host saves its full snapshot for the visualizer automatically; do not reconstruct a graph from the returned summary. Report additional source-review findings normally. Analyzer findings are ticketed automatically. Inspect layer boundaries and coupling. Report unavailable analyzers as skipped; never invent a graph or claim a fix from missing output.',
    scan: architectureScan,
  },
  {
    id: QUALITY_AUDIT_ID,
    name: 'Quality Audit',
    category: 'quality',
    icon: EXTERNAL_DIAGNOSTIC_ICONS[QUALITY_AUDIT_ID]!,
    blurb: 'Checks testing, CI, and build-integrity signals across your repositories.',
    agentWorkflow: 'quality_audit',
    instructions: 'Call analyze_codebase for measured dependency, duplication and unused-code data. Its pinned analyzers use npm cache; the audit host saves the full snapshot automatically. Do not reconstruct a snapshot from a summary or duplicate the automatically ticketed analyzer findings. Report additional source-review findings normally. Inspect existing scripts and run available typechecks, lint and tests. Verify unused candidates against dynamic entry points before recommending deletion. Report failed and skipped checks; do not invent clean results.',
    scan: qualityScan,
  },
  {
    id: PM_VISION_AUDIT_ID,
    name: 'Product Vision & Roadmap Audit',
    category: 'delivery',
    icon: EXTERNAL_DIAGNOSTIC_ICONS[PM_VISION_AUDIT_ID]!,
    blurb: 'Measures product direction: objectives, key results, roadmap, and a documented vision.',
    agentWorkflow: 'pm_vision_audit',
    instructions: 'Compare documented product vision, objectives, key results and roadmap against implemented behavior. Identify unsupported promises, missing acceptance criteria, unowned work and inconsistencies. Cite both the planning artifact and relevant implementation.',
    scan: pmVisionScan,
  },
  {
    id: PRIVACY_AUDIT_ID,
    name: 'Compliance Audit Agent',
    category: 'governance',
    icon: EXTERNAL_DIAGNOSTIC_ICONS[PRIVACY_AUDIT_ID]!,
    blurb: 'Reviews connected GitHub source for privacy, AI, marketing, minor-safety, transfer, and accessibility readiness across US federal/state, EU/EEA, UK, Canada, Brazil, and Australia requirements.',
    agentWorkflow: 'privacy_audit',
    instructions: 'Determine applicable data flows and jurisdictions. Inspect consent, notices, deletion, export, retention, marketing preferences, minor safeguards, AI disclosure, accessibility and vendor transfers. Verify actual implementations and tests; do not infer compliance solely from file names. Distinguish legal applicability questions from verified implementation defects.',
    ticketPerFinding: true,
    scan: privacyScan,
  },
];

export function getSystemAudit(id: string): SystemAudit | undefined {
  return SYSTEM_AUDITS.find((a) => a.id === id);
}

/** Client-safe audit summary (no scan fn). */
export interface SystemAuditSummary {
  id: string;
  name: string;
  category: ToolCategory;
  icon: string;
  blurb: string;
}

export function listSystemAudits(): SystemAuditSummary[] {
  return SYSTEM_AUDITS.map(({ id, name, category, icon, blurb }) => ({ id, name, category, icon, blurb }));
}
