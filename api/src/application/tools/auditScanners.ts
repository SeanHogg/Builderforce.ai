/**
 * Deterministic system-audit scanners — PURE functions from a gathered
 * `AuditScanContext` (repo file signals + project telemetry) to a `ToolResult`
 * (the same shape every diagnostic renders through). All IO (resolving repo
 * credentials, listing/reading files, counting rows) happens in `AuditRunner`;
 * these functions never touch the DB or network, so they are fully unit-testable
 * and the score they produce is deterministic.
 *
 * Each scanner returns a 1–5 CMMI-style score + a breakdown + a prioritized
 * remediation plan. When an agent audit run is unavailable (no cloud runtime /
 * no repo credentials) these ARE the audit; when it is available they are the
 * instant first-pass report + the score backstop.
 */
import type { ToolResult, ToolMetric, ToolRecommendation } from './toolTypes';

const LEVEL_NAMES = ['Initial', 'Managed', 'Defined', 'Quantitatively Managed', 'Optimizing'];
export const clampAuditLevel = (n: number): number => Math.max(1, Math.min(5, Math.round(n)));
const levelName = (n: number): string => LEVEL_NAMES[clampAuditLevel(n) - 1]!;
/** Round a 0–1 coverage fraction onto the 1–5 scale. */
const fracToScore = (frac: number): number => Math.round((1 + Math.max(0, Math.min(1, frac)) * 4) * 10) / 10;

// ── Gathered inputs (produced by AuditRunner.buildContext) ────────────────────

/** One connected repo, reduced to the boolean/scalar signals a scan needs. */
export interface ScannedRepo {
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  /** Whether the tree listing succeeded (false → repo could not be read). */
  read: boolean;
  hasCi: boolean;
  hasTests: boolean;
  hasReadme: boolean;
  hasLicense: boolean;
  hasSecurityPolicy: boolean;
  hasDependencyManifest: boolean;
  hasLockfile: boolean;
  hasCodeowners: boolean;
  hasContributing: boolean;
  /** Count of files that look like committed secrets/keys (heuristic). */
  suspectedSecrets: number;
  /** Total files discovered in the (capped) tree. */
  fileCount: number;

  // ── Privacy / data-law path signals (GDPR, CCPA/CPRA, CAN-SPAM) ──────────────
  /** A privacy policy page/document (privacy-policy, privacy.md, /privacy route). */
  hasPrivacyPolicy: boolean;
  /** A terms-of-service / terms-of-use document. */
  hasTermsOfService: boolean;
  /** A dedicated cookie policy document (distinct from the privacy policy). */
  hasCookiePolicy: boolean;
  /** A cookie/consent banner or consent-management component. */
  hasCookieConsent: boolean;
  /** An unsubscribe route/handler or List-Unsubscribe wiring (CAN-SPAM). */
  hasUnsubscribe: boolean;
  /** A self-service data export / DSAR "download my data" surface (portability). */
  hasDataExport: boolean;
  /** A self-service account deletion / right-to-erasure surface. */
  hasDataDeletion: boolean;
  /** A data-retention / purge / TTL routine for aging out stored data. */
  hasRetentionPolicy: boolean;
  /** A user-facing privacy-rights intake and appeal workflow. */
  hasRightsRequestWorkflow: boolean;
  /** Global Privacy Control / Sec-GPC or equivalent universal opt-out handling. */
  hasUniversalOptOut: boolean;
  /** Data Processing Addendum or processor-contract artifact. */
  hasDpa: boolean;
  /** Public or governed vendor/subprocessor inventory. */
  hasSubprocessorRegister: boolean;
  /** Record of processing, PII inventory, or data-flow map. */
  hasDataInventory: boolean;
  /** DPIA, privacy impact assessment, ADMT risk assessment, or AI impact assessment. */
  hasImpactAssessment: boolean;
  /** Personal-data incident / breach response procedure. */
  hasPrivacyIncidentResponse: boolean;
  /** Clear notice that a user is interacting with AI or that AI processes data. */
  hasAiTransparency: boolean;
  /** Human-review, contest, appeal, or profiling opt-out implementation. */
  hasAutomatedDecisionSafeguards: boolean;
  /** Child/minor age gate, parental-consent, or teen-safety implementation. */
  hasMinorSafety: boolean;
  /** Cross-border transfer mechanism, SCC, UK addendum, or transfer assessment. */
  hasTransferSafeguards: boolean;
  /** Accessibility statement, WCAG audit/config, or automated accessibility checks. */
  hasAccessibilityEvidence: boolean;
}

export interface GovernanceSignal {
  total: number;
  implemented: number;
}

export interface PlanningSignal {
  objectives: number;
  keyResults: number;
  initiatives: number;
  hasVisionDoc: boolean;
  hasRoadmap: boolean;
}

export interface AuditScanContext {
  projectId: number;
  projectName: string;
  reposConfigured: number;
  repos: ScannedRepo[];
  governance?: GovernanceSignal;
  planning?: PlanningSignal;
}

/** Fraction of scanned repos for which `pick` is true (0 when none readable). */
function repoFrac(repos: ScannedRepo[], pick: (r: ScannedRepo) => boolean): number {
  const readable = repos.filter((r) => r.read);
  if (readable.length === 0) return 0;
  return readable.filter(pick).length / readable.length;
}

function emptyResult(headline: string, summary: string): ToolResult {
  return { headline, summary, score: null, scoreLabel: null, metrics: [], recommendations: [] };
}

/** Compose a standard 1–5 result from weighted metric rows + a remediation plan. */
function compose(
  args: { score: number; scannedNote: string; metrics: ToolMetric[]; recommendations: ToolRecommendation[]; summary: string },
): ToolResult {
  const score = Math.round(args.score * 10) / 10;
  const label = levelName(score);
  return {
    headline: `${label} — ${score.toFixed(1)} / 5`,
    summary: `${args.summary} ${args.scannedNote}`.trim(),
    score,
    scoreLabel: label,
    metrics: args.metrics,
    recommendations: args.recommendations,
  };
}

// ── SOC 2 readiness (repo + governance signals → CC1–CC9) ─────────────────────

/**
 * A pragmatic SOC 2 readiness scan. Each Common-Criteria family is scored from
 * observable repo signals (and blended with the governance `soc_controls`
 * tracker when the workspace maintains one). Not a certification — a readiness
 * indicator that tells a team exactly what to close next.
 */
export function soc2Scan(ctx: AuditScanContext): ToolResult {
  const readable = ctx.repos.filter((r) => r.read);
  const scannedNote = `${readable.length} of ${ctx.reposConfigured} repo(s) scanned.`;
  if (readable.length === 0 && !ctx.governance) {
    return emptyResult('Not scored yet', `No readable repositories or SOC 2 controls found. ${scannedNote}`.trim());
  }

  // CC families mapped to observable signals (0–1 each).
  const noSecrets = repoFrac(readable, (r) => r.suspectedSecrets === 0);
  const changeMgmt = repoFrac(readable, (r) => r.hasCi) * 0.6 + repoFrac(readable, (r) => r.hasCodeowners) * 0.4;
  const vendorPolicy = repoFrac(readable, (r) => r.hasSecurityPolicy);
  const depIntegrity = repoFrac(readable, (r) => r.hasLockfile);
  const govFrac = ctx.governance && ctx.governance.total > 0 ? ctx.governance.implemented / ctx.governance.total : null;

  const families: Array<{ ref: string; label: string; frac: number }> = [
    { ref: 'CC1', label: 'Control Environment (ownership, CODEOWNERS)', frac: repoFrac(readable, (r) => r.hasCodeowners) },
    { ref: 'CC2', label: 'Communication & Policies (SECURITY, CONTRIBUTING)', frac: repoFrac(readable, (r) => r.hasSecurityPolicy) * 0.6 + repoFrac(readable, (r) => r.hasContributing) * 0.4 },
    { ref: 'CC3-CC5', label: 'Risk Assessment & Control Activities (CI gates)', frac: changeMgmt },
    { ref: 'CC6', label: 'Logical Access & Secrets Hygiene', frac: noSecrets },
    { ref: 'CC7', label: 'System Operations (dependency integrity)', frac: depIntegrity },
    { ref: 'CC8', label: 'Change Management (tests + review)', frac: repoFrac(readable, (r) => r.hasTests) * 0.5 + repoFrac(readable, (r) => r.hasCi) * 0.5 },
    { ref: 'CC9', label: 'Vendor & Risk Mitigation (security policy)', frac: vendorPolicy },
  ];

  const metrics: ToolMetric[] = families.map((f) => ({
    label: `${f.ref} — ${f.label}`,
    value: `${Math.round(f.frac * 100)}%`,
    tier: clampAuditLevel(fracToScore(f.frac)),
  }));
  if (govFrac != null) {
    metrics.push({
      label: 'Tracked SOC 2 controls implemented',
      value: `${ctx.governance!.implemented} / ${ctx.governance!.total}`,
      hint: 'From the governance SOC 2 control tracker',
      tier: clampAuditLevel(fracToScore(govFrac)),
    });
  }

  const recommendations: ToolRecommendation[] = [];
  if (noSecrets < 1) recommendations.push({ title: 'CC6 — Remove committed secrets', detail: 'One or more repos contain files that look like keys/credentials. Rotate them and move to a secrets manager; add secret scanning to CI.' });
  if (vendorPolicy < 1) recommendations.push({ title: 'CC9 — Add a SECURITY policy', detail: 'Add a SECURITY.md with a disclosure process and vendor-risk notes to every repo.' });
  if (changeMgmt < 1) recommendations.push({ title: 'CC3–CC5 — Enforce change gates', detail: 'Require CI checks and code review (CODEOWNERS) on the default branch of each repo.' });
  if (depIntegrity < 1) recommendations.push({ title: 'CC7 — Commit dependency lockfiles', detail: 'Pin dependencies with a committed lockfile so builds are reproducible and auditable.' });
  if (govFrac == null) recommendations.push({ title: 'Seed a SOC 2 control register', detail: 'Track CC1–CC9 controls with owners and evidence in Governance → SOC 2 for a blended, evidence-backed score.' });

  const parts = [noSecrets, changeMgmt, vendorPolicy, depIntegrity, ...families.map((f) => f.frac), ...(govFrac != null ? [govFrac] : [])];
  const score = fracToScore(parts.reduce((s, v) => s + v, 0) / parts.length);
  return compose({ score, scannedNote, metrics, recommendations, summary: 'SOC 2 readiness across the Common Criteria, scored from repo controls and your governance register.' });
}

// ── Architecture (shared derivation reused by AnalysisRunnerDO) ────────────────

export interface ArchitecturePrinciple { key: string; label: string; score?: number; notes?: string }

/**
 * Derive a 1–5 architecture diagnostic from design-principle scores (each 0–10:
 * DRY, SOLID, DDD, Patterns → averaged → halved). Extracted from the durable
 * AnalysisRunnerDO so the runner and the deterministic audit share ONE scorer
 * (no duplicated LEVEL_NAMES/clamp/averaging). Returns null when no principle
 * was scored.
 */
export function deriveArchitectureResult(principles: ArchitecturePrinciple[]): ToolResult | null {
  const rows = principles.filter((p): p is Required<Pick<ArchitecturePrinciple, 'key' | 'label' | 'score'>> & ArchitecturePrinciple => typeof p.score === 'number');
  if (rows.length === 0) return null;
  const avg10 = rows.reduce((s, p) => s + Math.max(0, Math.min(10, p.score!)), 0) / rows.length;
  const score = Math.round((avg10 / 2) * 10) / 10;
  return {
    headline: `${levelName(score)} — ${score.toFixed(1)} / 5`,
    summary: 'Design-principle adherence (DRY, SOLID, DDD, patterns) from the latest architecture analysis.',
    score,
    scoreLabel: levelName(score),
    metrics: rows.map((p) => {
      const v = Math.max(0, Math.min(10, p.score!));
      return { label: p.label, value: `${v}/10`, hint: p.notes?.slice(0, 160), tier: clampAuditLevel(v / 2) };
    }),
    recommendations: [],
  };
}

/** Lightweight architecture scan from repo structure signals — used when a full
 *  agent-driven architecture analysis has not run. */
export function architectureScan(ctx: AuditScanContext): ToolResult {
  const readable = ctx.repos.filter((r) => r.read);
  const scannedNote = `${readable.length} of ${ctx.reposConfigured} repo(s) scanned.`;
  if (readable.length === 0) return emptyResult('Not scored yet', `No readable repositories found. ${scannedNote}`.trim());

  const signals: Array<{ label: string; frac: number; rec?: ToolRecommendation }> = [
    { label: 'Modular structure (dependency manifest present)', frac: repoFrac(readable, (r) => r.hasDependencyManifest) },
    { label: 'Documented (README present)', frac: repoFrac(readable, (r) => r.hasReadme), rec: { title: 'Document each service', detail: 'Add a README describing purpose, boundaries, and how to run each repo.' } },
    { label: 'Ownership boundaries (CODEOWNERS)', frac: repoFrac(readable, (r) => r.hasCodeowners), rec: { title: 'Define ownership', detail: 'Add CODEOWNERS so module boundaries have accountable owners.' } },
    { label: 'Tested (test suite present)', frac: repoFrac(readable, (r) => r.hasTests), rec: { title: 'Establish a test suite', detail: 'Add automated tests to protect refactors and encode design intent.' } },
  ];
  const metrics: ToolMetric[] = signals.map((s) => ({ label: s.label, value: `${Math.round(s.frac * 100)}%`, tier: clampAuditLevel(fracToScore(s.frac)) }));
  const recommendations = signals.filter((s) => s.frac < 1 && s.rec).map((s) => s.rec!);
  const score = fracToScore(signals.reduce((s, v) => s + v.frac, 0) / signals.length);
  return compose({ score, scannedNote, metrics, recommendations, summary: 'Architecture health from repository structure signals. Run the full Architecture analysis for a deep, principle-scored diagnostic.' });
}

// ── Quality (tests / CI / observability) ──────────────────────────────────────

export function qualityScan(ctx: AuditScanContext): ToolResult {
  const readable = ctx.repos.filter((r) => r.read);
  const scannedNote = `${readable.length} of ${ctx.reposConfigured} repo(s) scanned.`;
  if (readable.length === 0) return emptyResult('Not scored yet', `No readable repositories found. ${scannedNote}`.trim());

  const signals: Array<{ label: string; frac: number; rec?: ToolRecommendation }> = [
    { label: 'Automated tests', frac: repoFrac(readable, (r) => r.hasTests), rec: { title: 'Add automated tests', detail: 'Introduce a unit/integration test suite so regressions are caught before merge.' } },
    { label: 'Continuous integration', frac: repoFrac(readable, (r) => r.hasCi), rec: { title: 'Wire CI', detail: 'Add a CI workflow that runs build + tests on every pull request.' } },
    { label: 'Reproducible builds (lockfile)', frac: repoFrac(readable, (r) => r.hasLockfile), rec: { title: 'Commit lockfiles', detail: 'Pin dependencies so CI and production build the same artifact.' } },
    { label: 'Contributor guide', frac: repoFrac(readable, (r) => r.hasContributing) },
  ];
  const metrics: ToolMetric[] = signals.map((s) => ({ label: s.label, value: `${Math.round(s.frac * 100)}%`, tier: clampAuditLevel(fracToScore(s.frac)) }));
  const recommendations = signals.filter((s) => s.frac < 1 && s.rec).map((s) => s.rec!);
  const score = fracToScore(signals.reduce((s, v) => s + v.frac, 0) / signals.length);
  return compose({ score, scannedNote, metrics, recommendations, summary: 'Engineering quality from testing, CI, and build-integrity signals.' });
}

// ── PM Vision & Roadmap (planning-spine completeness) ─────────────────────────

export function pmVisionScan(ctx: AuditScanContext): ToolResult {
  const p = ctx.planning ?? { objectives: 0, keyResults: 0, initiatives: 0, hasVisionDoc: false, hasRoadmap: false };
  const repos = ctx.repos.filter((r) => r.read);
  const signals: Array<{ label: string; frac: number; rec?: ToolRecommendation }> = [
    { label: 'Objectives defined', frac: p.objectives > 0 ? Math.min(1, p.objectives / 3) : 0, rec: { title: 'Set objectives', detail: 'Define 2–3 outcome objectives for this project so work ladders to a goal.' } },
    { label: 'Measurable key results', frac: p.keyResults > 0 ? Math.min(1, p.keyResults / 3) : 0, rec: { title: 'Add key results', detail: 'Attach measurable key results to each objective so progress is trackable.' } },
    { label: 'Initiatives / roadmap', frac: (p.initiatives > 0 ? 0.5 : 0) + (p.hasRoadmap ? 0.5 : 0), rec: { title: 'Build a roadmap', detail: 'Sequence initiatives on the planning spine so the roadmap is explicit and dated.' } },
    { label: 'Vision documented', frac: p.hasVisionDoc || repos.some((r) => r.hasReadme) ? 1 : 0, rec: { title: 'Write the vision', detail: 'Capture a one-page product vision (problem, users, differentiation) as a spec/doc.' } },
  ];
  const metrics: ToolMetric[] = signals.map((s) => ({ label: s.label, value: `${Math.round(s.frac * 100)}%`, tier: clampAuditLevel(fracToScore(s.frac)) }));
  const recommendations = signals.filter((s) => s.frac < 1 && s.rec).map((s) => s.rec!);
  const score = fracToScore(signals.reduce((s, v) => s + v.frac, 0) / signals.length);
  return compose({ score, scannedNote: '', metrics, recommendations, summary: 'Product direction from planning-spine completeness: objectives, key results, roadmap, and a documented vision.' });
}

// ── Privacy, AI & Website Compliance (multi-jurisdiction) ─────────────────────

/**
 * A pragmatic privacy & data-law readiness scan. Each legal pillar is scored from
 * observable repo signals — presence of a privacy policy, a cookie-consent surface,
 * an unsubscribe path, self-service data export & deletion, and a retention routine.
 * Not legal advice — a readiness indicator that tells a team exactly which
 * data-subject obligation to close next. The agent deep-pass (privacy_audit
 * workflow) verifies the CONTENT (e.g. does the email footer carry List-Unsubscribe
 * + a physical address, is consent gated before analytics fire); this deterministic
 * scan is the instant first-pass report + the score backstop.
 */
export function privacyScan(ctx: AuditScanContext): ToolResult {
  const readable = ctx.repos.filter((r) => r.read);
  const scannedNote = `${readable.length} of ${ctx.reposConfigured} repo(s) scanned.`;
  if (readable.length === 0) {
    return emptyResult('Not scored yet', `No readable repositories found to scan for privacy & data-law signals. ${scannedNote}`.trim());
  }

  // Each legal pillar → observable repo signals (0–1 coverage across scanned repos).
  const hasPrivacyPolicy = repoFrac(readable, (r) => r.hasPrivacyPolicy);
  const hasCookieConsent = repoFrac(readable, (r) => r.hasCookieConsent);
  const hasCookiePolicy = repoFrac(readable, (r) => r.hasCookiePolicy);
  const hasDataExport = repoFrac(readable, (r) => r.hasDataExport);
  const hasDataDeletion = repoFrac(readable, (r) => r.hasDataDeletion);
  const hasUnsubscribe = repoFrac(readable, (r) => r.hasUnsubscribe);
  const hasTerms = repoFrac(readable, (r) => r.hasTermsOfService);
  const hasRetention = repoFrac(readable, (r) => r.hasRetentionPolicy);
  const hasRightsWorkflow = repoFrac(readable, (r) => r.hasRightsRequestWorkflow);
  const hasUniversalOptOut = repoFrac(readable, (r) => r.hasUniversalOptOut);
  const hasDpa = repoFrac(readable, (r) => r.hasDpa);
  const hasSubprocessors = repoFrac(readable, (r) => r.hasSubprocessorRegister);
  const hasInventory = repoFrac(readable, (r) => r.hasDataInventory);
  const hasAssessment = repoFrac(readable, (r) => r.hasImpactAssessment);
  const hasIncidentResponse = repoFrac(readable, (r) => r.hasPrivacyIncidentResponse);
  const hasAiTransparency = repoFrac(readable, (r) => r.hasAiTransparency);
  const hasAutomatedSafeguards = repoFrac(readable, (r) => r.hasAutomatedDecisionSafeguards);
  const hasMinorSafety = repoFrac(readable, (r) => r.hasMinorSafety);
  const hasTransfers = repoFrac(readable, (r) => r.hasTransferSafeguards);
  const hasAccessibility = repoFrac(readable, (r) => r.hasAccessibilityEvidence);

  const pillars: Array<{ ref: string; label: string; frac: number }> = [
    { ref: 'GDPR 13–14 · US state notices · APP 1', label: 'Public notice and ownership terms', frac: hasPrivacyPolicy * 0.65 + hasTerms * 0.35 },
    { ref: 'GDPR 15–22 · US state rights · LGPD 18', label: 'Rights intake, access, portability, deletion, and appeal', frac: hasRightsWorkflow * 0.25 + hasDataExport * 0.35 + hasDataDeletion * 0.4 },
    { ref: 'ePrivacy/PECR · GPC · CAN-SPAM', label: 'Tracking and marketing choice controls', frac: hasCookieConsent * 0.35 + hasCookiePolicy * 0.15 + hasUniversalOptOut * 0.25 + hasUnsubscribe * 0.25 },
    { ref: 'GDPR 5/30 · PIPEDA · APP 11', label: 'Data inventory, minimization, and retention', frac: hasInventory * 0.45 + hasRetention * 0.55 },
    { ref: 'GDPR 28/44–49 · UK · APP 8', label: 'DPA, subprocessors, and international transfers', frac: hasDpa * 0.35 + hasSubprocessors * 0.3 + hasTransfers * 0.35 },
    { ref: 'GDPR 32–35 · US assessments · NDB', label: 'Impact assessment and breach response', frac: hasAssessment * 0.5 + hasIncidentResponse * 0.5 },
    { ref: 'EU AI Act · CCPA ADMT · CO ADMT', label: 'AI transparency and consequential-decision safeguards', frac: hasAiTransparency * 0.45 + hasAutomatedSafeguards * 0.55 },
    { ref: 'COPPA · state minor/health/biometric laws', label: 'Minor and sensitive-data safeguards', frac: hasMinorSafety },
    { ref: 'ADA Title III · WCAG 2.2', label: 'Website accessibility evidence', frac: hasAccessibility },
  ];

  const metrics: ToolMetric[] = pillars.map((p) => ({
    label: `${p.ref} — ${p.label}`,
    value: `${Math.round(p.frac * 100)}%`,
    tier: clampAuditLevel(fracToScore(p.frac)),
  }));

  const recommendations: ToolRecommendation[] = [];
  if (hasPrivacyPolicy < 1 || hasTerms < 1) recommendations.push({ title: 'Global notice — Publish versioned legal documents', detail: 'No complete repository path signal was found for both Terms and Privacy. Publish public, versioned documents naming Fix Faster LLC d/b/a BuilderForce.ai, data categories, purposes, legal bases, recipients, retention, AI processing, and rights.' });
  if (hasRightsWorkflow < 1 || hasDataExport < 1 || hasDataDeletion < 1) recommendations.push({ title: 'Global rights — Export, erasure, and DSAR operations', detail: 'Verify or add authenticated access, correction, portable export, deletion across primary stores/processors/backups, identity verification, statutory timing, denial reasons, and an appeal channel. A ticket table alone is not end-to-end fulfillment.' });
  if (hasCookieConsent < 1 || hasUniversalOptOut < 1) recommendations.push({ title: 'EU/UK/US states — Consent and universal opt-out', detail: 'Block non-essential tags before opt-in where required, make Reject as easy as Accept, retain consent evidence, expose preference controls, and honor Sec-GPC/Global Privacy Control for sale, sharing, and targeted advertising.' });
  if (hasUnsubscribe < 1) recommendations.push({ title: 'CAN-SPAM/Canada/EU — Unsubscribe and suppression', detail: 'Verify working unsubscribe links, List-Unsubscribe headers, lawful sender identity and postal address, consent where required, and a durable suppression list applied to every sender.' });
  if (hasInventory < 1 || hasRetention < 1) recommendations.push({ title: 'Global governance — Inventory data and enforce retention', detail: 'Maintain a record of processing/data-flow inventory covering prompts, chats, repositories, model providers, logs, billing, and integrations; map purpose, legal basis, owner, region, and deletion schedule to an enforced purge.' });
  if (hasDpa < 1 || hasSubprocessors < 1 || hasTransfers < 1) recommendations.push({ title: 'EU/UK/Australia — Contract and transfer controls', detail: 'Publish the subprocessor list and provide a DPA. Verify processor terms, deletion/training restrictions, SCCs or UK transfer terms, transfer assessments, notice of changes, and likely overseas locations.' });
  if (hasAssessment < 1 || hasIncidentResponse < 1) recommendations.push({ title: 'GDPR/US states/Canada/Australia — Assessments and breach plan', detail: 'Add repeatable DPIA/data-protection/ADMT assessment records and a tested incident plan with jurisdiction-aware notification clocks, processor escalation, evidence preservation, and breach registers.' });
  if (hasAiTransparency < 1 || hasAutomatedSafeguards < 1) recommendations.push({ title: 'AI laws — Transparency and human review', detail: 'Disclose AI interactions and providers; classify prohibited/high-risk/consequential uses; document tests, limitations, provenance, and monitoring; and add notice, explanation, correction, appeal, opt-out, and meaningful human-review controls where applicable.' });
  if (hasMinorSafety < 1) recommendations.push({ title: 'COPPA and state minor laws — Age and safety controls', detail: 'Because this is a conversational-agent platform, verify audience and age-assurance strategy, parental consent where required, minor-safe defaults, data minimization/deletion, content safeguards, self-harm response, and upcoming Colorado reporting readiness.' });
  if (hasAccessibility < 1) recommendations.push({ title: 'ADA/WCAG — Validate accessible operation', detail: 'Add automated and manual WCAG 2.2 AA evidence for keyboard use, focus, names/labels, contrast, errors, live AI updates, reduced motion, and screen readers, plus an accessibility feedback route.' });

  const parts = pillars.map((p) => p.frac);
  const score = fracToScore(parts.reduce((s, v) => s + v, 0) / parts.length);
  return compose({
    score,
    scannedNote,
    metrics,
    recommendations,
    summary: 'Privacy, AI-governance, marketing, minor-safety, transfer, and accessibility readiness across US federal/state, EU/EEA, UK, Canada, Brazil, and Australia requirements. Path signals are evidence leads, not legal certification; run the Compliance Audit Agent for content and behavior validation.',
  });
}
