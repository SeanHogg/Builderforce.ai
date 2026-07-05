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
import { ARCHITECTURE_DIAGNOSTIC_ID, SOC2_AUDIT_ID, QUALITY_AUDIT_ID, PM_VISION_AUDIT_ID, PRIVACY_AUDIT_ID } from './auditIds';
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
    icon: '🛡️',
    blurb: 'Scans your repos and controls against the SOC 2 Common Criteria (CC1–CC9) and tells you exactly what to close next.',
    agentWorkflow: 'security_audit',
    scan: soc2Scan,
  },
  {
    id: ARCHITECTURE_DIAGNOSTIC_ID,
    name: 'Architecture Analysis',
    category: 'quality',
    icon: '🏛️',
    blurb: 'Rates design-principle adherence (DRY, SOLID, DDD, patterns) across your codebase.',
    agentWorkflow: 'architecture',
    scan: architectureScan,
  },
  {
    id: QUALITY_AUDIT_ID,
    name: 'Quality Audit',
    category: 'quality',
    icon: '✅',
    blurb: 'Checks testing, CI, and build-integrity signals across your repositories.',
    agentWorkflow: 'quality_audit',
    scan: qualityScan,
  },
  {
    id: PM_VISION_AUDIT_ID,
    name: 'Product Vision & Roadmap Audit',
    category: 'delivery',
    icon: '🧭',
    blurb: 'Measures product direction: objectives, key results, roadmap, and a documented vision.',
    agentWorkflow: 'pm_vision_audit',
    scan: pmVisionScan,
  },
  {
    id: PRIVACY_AUDIT_ID,
    name: 'Privacy & Data-Law Compliance',
    category: 'governance',
    icon: '⚖️',
    blurb: 'Scans your repos for GDPR, CCPA/CPRA, and CAN-SPAM readiness — privacy policy, cookie consent, unsubscribe, data export & erasure, and retention — and tells you exactly what to close next.',
    agentWorkflow: 'privacy_audit',
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
