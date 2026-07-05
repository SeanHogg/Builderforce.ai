/**
 * System-level audit diagnostic ids — the SINGLE source of truth shared by the
 * tools engine (ToolService), the audit runner, the routes, and the durable
 * analysis runner.
 *
 * These audits are consolidated INTO the generic Diagnostics & Tools engine:
 * each one is an externally-scored diagnostic (there is no self-assessment /
 * compute form — the score comes from a repo/project scan or an agent run), so
 * a run is just a `tool_runs` row keyed by these ids, recorded via
 * `ToolService.recordExternalRun`. That is why they automatically flow into the
 * per-project rating (`getProjectScore`) and the tenant rollup (`getTenantRollup`)
 * and render in the generic `ToolResultView` — no bespoke tables or pages.
 */

/** Architecture analysis — recorded by the durable AnalysisRunnerDO from the
 *  design-principles artifact. Pre-existing; kept here so all audit ids live in
 *  one place. */
export const ARCHITECTURE_DIAGNOSTIC_ID = 'architecture-analysis';
/** SOC 2 readiness audit — repo + governance-control scan mapped to CC1–CC9. */
export const SOC2_AUDIT_ID = 'soc2-audit';
/** Engineering quality audit — tests / CI / observability signals. */
export const QUALITY_AUDIT_ID = 'quality-audit';
/** Product vision & roadmap audit — planning-spine completeness. */
export const PM_VISION_AUDIT_ID = 'pm-vision-audit';
/** Privacy & data-law compliance audit — GDPR, CCPA/CPRA, and CAN-SPAM readiness
 *  scanned from repo signals (privacy policy, cookie consent, unsubscribe, data
 *  export / erasure, retention) and deepened by the compliance agent pass. */
export const PRIVACY_AUDIT_ID = 'privacy-compliance-audit';

/** Display names for these externally-scored diagnostics (no registered Tool
 *  definition provides one). Merged into ToolService.diagnosticName resolution. */
export const EXTERNAL_DIAGNOSTIC_NAMES: Record<string, string> = {
  [ARCHITECTURE_DIAGNOSTIC_ID]: 'Architecture Analysis',
  [SOC2_AUDIT_ID]: 'SOC 2 Readiness Audit',
  [QUALITY_AUDIT_ID]: 'Quality Audit',
  [PM_VISION_AUDIT_ID]: 'Product Vision & Roadmap Audit',
  [PRIVACY_AUDIT_ID]: 'Privacy & Data-Law Compliance',
};
