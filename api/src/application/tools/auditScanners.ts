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

// ── Privacy & Data-Law Compliance (GDPR / CCPA·CPRA / CAN-SPAM) ────────────────

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

  const pillars: Array<{ ref: string; label: string; frac: number }> = [
    { ref: 'GDPR Art. 13–14', label: 'Transparency (privacy policy published)', frac: hasPrivacyPolicy },
    { ref: 'GDPR Art. 7 · ePrivacy', label: 'Consent (cookie/tracking consent surface)', frac: hasCookieConsent * 0.7 + hasCookiePolicy * 0.3 },
    { ref: 'GDPR Art. 20 · CCPA §1798.100', label: 'Access & portability (self-service data export)', frac: hasDataExport },
    { ref: 'GDPR Art. 17 · CCPA §1798.105', label: 'Erasure / deletion (right to be forgotten)', frac: hasDataDeletion },
    { ref: 'CAN-SPAM §5', label: 'Opt-out (unsubscribe + List-Unsubscribe path)', frac: hasUnsubscribe },
    { ref: 'GDPR Art. 5(1)(e)', label: 'Storage limitation (retention / purge routine)', frac: hasRetention },
    { ref: 'Contract', label: 'Terms of service published', frac: hasTerms },
  ];

  const metrics: ToolMetric[] = pillars.map((p) => ({
    label: `${p.ref} — ${p.label}`,
    value: `${Math.round(p.frac * 100)}%`,
    tier: clampAuditLevel(fracToScore(p.frac)),
  }));

  const recommendations: ToolRecommendation[] = [];
  if (hasPrivacyPolicy < 1) recommendations.push({ title: 'GDPR/CCPA — Publish a privacy policy', detail: 'Ship a public, versioned privacy policy that names the data you collect, the legal basis, retention, and how to exercise data-subject rights. It must be reachable without logging in.' });
  if (hasCookieConsent < 1) recommendations.push({ title: 'ePrivacy/CPRA — Add cookie consent', detail: 'Gate analytics/marketing tags behind an opt-in consent banner (Consent Mode). Do not fire trackers before consent; offer a "reject all" as prominent as "accept".' });
  if (hasDataExport < 1) recommendations.push({ title: 'GDPR Art. 20 — Self-service data export', detail: 'Add a "download my data" endpoint that returns a user\'s personal data in a portable (JSON/CSV) format, so DSARs are not a manual process.' });
  if (hasDataDeletion < 1) recommendations.push({ title: 'GDPR Art. 17 / CCPA — Right to erasure', detail: 'Add a self-service account-deletion / erasure endpoint that actually deletes (or irreversibly anonymises) the subject\'s rows, not just suspends the account.' });
  if (hasUnsubscribe < 1) recommendations.push({ title: 'CAN-SPAM — Unsubscribe + physical address', detail: 'Every marketing email must carry a working unsubscribe link, a List-Unsubscribe header, and a valid physical postal address in the footer. Honour opt-outs within 10 business days.' });
  if (hasRetention < 1) recommendations.push({ title: 'GDPR Art. 5(1)(e) — Define retention', detail: 'Add a scheduled purge that ages out PII-bearing logs (sessions, IPs, marketing events) on a documented retention window instead of keeping them forever.' });

  const parts = pillars.map((p) => p.frac);
  const score = fracToScore(parts.reduce((s, v) => s + v, 0) / parts.length);
  return compose({
    score,
    scannedNote,
    metrics,
    recommendations,
    summary: 'Privacy & data-law readiness across GDPR, CCPA/CPRA, and CAN-SPAM, scored from repository signals. Run the deep compliance pass for a content-level review (email footers, consent gating, DPA/subprocessors).',
  });
}
