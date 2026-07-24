/**
 * githubAlerts — GitHub code-scanning (CodeQL) + Dependabot alerts → SECURITY tickets.
 *
 * WHY THIS EXISTS
 * The platform already has exactly one place a security finding becomes work:
 * {@link SecurityAuditService.recordFinding}, which mints a `taskType='security'`
 * task carrying severity / Trust Service Criterion / location. The Security agent
 * reports through it. GitHub's own scanners (CodeQL and Dependabot) produce the
 * same kind of finding but arrive over a completely different channel, so without
 * this module they sit in the GitHub UI where nobody triages them. Mapping them
 * onto the SAME pipeline means one board, one severity vocabulary, one audit
 * ledger — not a second parallel "alerts" surface that would have to be built,
 * reported on, and kept in sync forever.
 *
 * TWO INGEST PATHS, deliberately
 *   - Webhook (`code_scanning_alert`, `dependabot_alert`) — the live path.
 *   - Pull-based backfill ({@link ingestOpenAlertsForRepo}) — for repos where the
 *     webhook was never installed or a delivery was dropped. This mirrors why
 *     `pollPrCiStatus` exists: a feature that only works when a webhook was
 *     correctly configured is a feature that silently doesn't work.
 *
 * CONVENTIONS THIS FOLLOWS
 * - Tagged results, never throws. These functions run inside a webhook handler
 *   whose contract is to answer 200 for everything it cannot process (so GitHub
 *   stops retrying) and inside best-effort sweeps. A thrown error in either place
 *   is either an infinite redelivery loop or a dead sweep, so every failure mode
 *   here is a `{ok:false, code, reason}` the caller can report. Matches
 *   githubClient.ts / pollPrCiStatus.ts.
 * - All GitHub IO goes through `githubRequest` + `resolveRepoAuth`; no hand-rolled
 *   fetch or auth headers.
 * - Mapping is pure and separated from IO so it is unit-testable without a DB.
 */
import { openTaskMarkers } from './findingMarkers';
import { SecurityAuditService, type FindingSeverity } from './SecurityAuditService';
import { githubRequest, repoPath, resolveRepoAuth, type GitHubCoords } from '../repos/githubClient';
import { resolveRepoLink } from '../contributors/activityIngest';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

// ── Loose accessors ──────────────────────────────────────────────────────────
// Same style as githubWebhookRoutes: a missing/odd field degrades to a skipped
// alert, never a throw. GitHub reshapes these payloads over time.
const g = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const gs = (o: unknown, k: string): string | null => { const v = g(o, k); return typeof v === 'string' ? v : null; };
const gn = (o: unknown, k: string): number | null => { const v = g(o, k); return typeof v === 'number' ? v : null; };

export type AlertSource = 'code-scanning' | 'dependabot';

/** The GitHub webhook event names this module handles. */
export const ALERT_EVENTS = new Set(['code_scanning_alert', 'dependabot_alert']);

/**
 * Alert `action` values that mean "this is live, open work".
 *
 * GitHub emits both lifecycle halves on the same event name. We ingest only the
 * opening half; `fixed` / `closed_by_user` / `dismissed` / `auto_dismissed`
 * deliberately mint NOTHING. Creating a ticket for a resolved alert would be
 * manufacturing work out of good news, and the platform has no "auto-close a
 * ticket from an external signal" contract to pair it with — so the honest
 * behaviour is to acknowledge and drop.
 *
 * The `*_by_user` / `reintroduced` / `auto_reopened` variants are included
 * because they are semantically identical to `reopened`: the vulnerability is
 * open again and needs an owner.
 */
export const INGESTABLE_ALERT_ACTIONS = new Set([
  'created',
  'reopened',
  'reopened_by_user',
  'reintroduced',
  'auto_reopened',
  'appeared_in_branch',
]);

/** A GitHub alert normalized onto the platform's finding shape. */
export interface AlertFinding {
  source: AlertSource;
  /** GitHub's per-repo alert number — the stable identity we dedupe on. */
  number: number;
  /** `owner/repo` the alert belongs to. */
  repoFullName: string;
  title: string;
  detail: string;
  severity: FindingSeverity;
  location: string | null;
  recommendation: string | null;
  url: string | null;
  /** The dedupe marker embedded in `title` (see {@link alertMarker}). */
  marker: string;
}

// ── Severity mapping ─────────────────────────────────────────────────────────

/**
 * GitHub severity vocabulary → platform {@link FindingSeverity}.
 *
 * GitHub uses TWO scales on code-scanning alerts and one on Dependabot:
 *
 *   1. `rule.security_severity_level` — critical|high|medium|low. Only present on
 *      security-relevant rules (it is CVSS-derived). This is the authoritative
 *      one and maps 1:1 onto our scale, so we prefer it whenever present.
 *   2. `rule.severity` — none|note|warning|error. Present on EVERY rule
 *      including non-security quality rules. It is a lint-style scale, not a
 *      risk scale, so it is only consulted as a fallback and is mapped
 *      conservatively DOWNWARD:
 *        error   → high    (a real defect, but no CVSS says it's exploitable)
 *        warning → medium
 *        note    → info    (advisory; deliberately NOT 'low', so the board isn't
 *                           flooded with style nits carrying real priority)
 *        none    → info
 *      Mapping `error` to `critical` would let a non-security CodeQL rule mint an
 *      URGENT ticket, which is exactly the false-alarm pattern that gets a
 *      security feed muted.
 *   3. Dependabot `security_advisory.severity` / `security_vulnerability.severity`
 *      — critical|high|medium|low, already our vocabulary, mapped 1:1.
 *
 * Unknown/absent → 'medium', matching `recordFinding`'s own default: an
 * unclassified security alert is not evidence of low risk.
 */
const SEVERITY_MAP: Record<string, FindingSeverity> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  moderate: 'medium', // GHSA advisories say "moderate" where CVSS says "medium"
  low: 'low',
  error: 'high',
  warning: 'medium',
  note: 'info',
  none: 'info',
  info: 'info',
};

export function mapAlertSeverity(...candidates: Array<string | null | undefined>): FindingSeverity {
  for (const c of candidates) {
    if (!c) continue;
    const hit = SEVERITY_MAP[c.trim().toLowerCase()];
    if (hit) return hit;
  }
  return 'medium';
}

// ── Dedupe ───────────────────────────────────────────────────────────────────

/**
 * The stable identity marker embedded in every alert-derived ticket title.
 *
 * WHY A TITLE MARKER RATHER THAN A COLUMN
 * `recordFinding` has no idempotency key and there is no findings table — a
 * finding IS a ticket — so dedupe has to key off something already on `tasks`.
 * Adding a column would mean a migration for a feature whose identity
 * (`repo + alert number`) is perfectly stable and already human-meaningful, so
 * we embed it in the title exactly like `AuditRunner` dedupes on lowercased open
 * task titles. Same query, same semantics, no schema change. The marker is also
 * greppable on the board, which a hidden column would not be.
 *
 * Webhook re-delivery (GitHub retries aggressively) and an overlapping backfill
 * therefore both collapse onto the same ticket.
 *
 * SCOPE: like AuditRunner, we only dedupe against OPEN tickets. If a human closed
 * the ticket and GitHub re-opens the alert, refiling is correct — the
 * vulnerability came back and needs an owner again.
 */
export function alertMarker(source: AlertSource, repoFullName: string, number: number): string {
  return `[gh:${source}:${repoFullName.toLowerCase()}#${number}]`;
}

/** Every GitHub-alert marker currently carried by an OPEN task in a project. */
export async function openAlertMarkers(db: Db, projectId: number): Promise<Set<string>> {
  return openTaskMarkers(db, projectId, /\[gh:(?:code-scanning|dependabot):[^\]]+\]/);
}

// ── Payload → finding ────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** A code-scanning (CodeQL) alert object → finding. Null when unmappable. */
export function codeScanningFinding(alert: unknown, repoFullName: string): AlertFinding | null {
  const number = gn(alert, 'number');
  if (number == null) return null;

  const rule = g(alert, 'rule');
  const tool = gs(g(alert, 'tool'), 'name') ?? 'Code scanning';
  const instance = g(alert, 'most_recent_instance');
  const loc = g(instance, 'location');

  const ruleName =
    gs(rule, 'description') ??
    gs(g(instance, 'message'), 'text') ??
    gs(rule, 'id') ??
    'Code scanning alert';
  const marker = alertMarker('code-scanning', repoFullName, number);

  const path = gs(loc, 'path');
  const line = gn(loc, 'start_line');
  const location = path ? (line != null ? `${path}:${line}` : path) : null;

  const detailParts = [
    `${tool} alert #${number} in \`${repoFullName}\`.`,
    gs(rule, 'full_description') ?? gs(g(instance, 'message'), 'text') ?? '',
    gs(rule, 'id') ? `\n**Rule:** \`${gs(rule, 'id')}\`` : '',
    gs(alert, 'html_url') ? `\n**Alert:** ${gs(alert, 'html_url')}` : '',
  ].filter(Boolean);

  return {
    source: 'code-scanning',
    number,
    repoFullName,
    title: truncate(`${tool}: ${ruleName}`, 460) + ` ${marker}`,
    detail: detailParts.join('\n'),
    severity: mapAlertSeverity(gs(rule, 'security_severity_level'), gs(rule, 'severity')),
    location,
    recommendation: gs(rule, 'help') ? truncate(String(gs(rule, 'help')), 2000) : null,
    url: gs(alert, 'html_url'),
    marker,
  };
}

/** A Dependabot alert object → finding. Null when unmappable. */
export function dependabotFinding(alert: unknown, repoFullName: string): AlertFinding | null {
  const number = gn(alert, 'number');
  if (number == null) return null;

  const dependency = g(alert, 'dependency');
  const pkg = g(dependency, 'package');
  const advisory = g(alert, 'security_advisory');
  const vuln = g(alert, 'security_vulnerability');

  const pkgName = gs(pkg, 'name') ?? 'dependency';
  const ecosystem = gs(pkg, 'ecosystem');
  const summary = gs(advisory, 'summary') ?? `Vulnerable dependency ${pkgName}`;
  const marker = alertMarker('dependabot', repoFullName, number);

  // Dependabot has no file:line — the manifest that pulls the package in is the
  // actionable location (it's the file you edit to fix it).
  const location = gs(dependency, 'manifest_path');

  const patched = gs(g(vuln, 'first_patched_version'), 'identifier');
  const range = gs(vuln, 'vulnerable_version_range');
  const ids = [gs(advisory, 'cve_id'), gs(advisory, 'ghsa_id')].filter(Boolean).join(' / ');

  const detailParts = [
    `Dependabot alert #${number} in \`${repoFullName}\`.`,
    gs(advisory, 'description') ?? summary,
    ecosystem ? `\n**Package:** \`${pkgName}\` (${ecosystem})` : `\n**Package:** \`${pkgName}\``,
    range ? `\n**Vulnerable range:** ${range}` : '',
    ids ? `\n**Advisory:** ${ids}` : '',
    gs(alert, 'html_url') ? `\n**Alert:** ${gs(alert, 'html_url')}` : '',
  ].filter(Boolean);

  return {
    source: 'dependabot',
    number,
    repoFullName,
    title: truncate(`Dependabot: ${summary}`, 460) + ` ${marker}`,
    detail: detailParts.join('\n'),
    // The advisory severity is the CVSS one; the per-vulnerability severity is a
    // fallback for advisories that only score at the affected-package level.
    severity: mapAlertSeverity(gs(advisory, 'severity'), gs(vuln, 'severity')),
    location,
    recommendation: patched
      ? `Upgrade \`${pkgName}\` to ${patched} or later.`
      : 'No patched version is published yet — pin, patch, or remove the dependency.',
    url: gs(alert, 'html_url'),
    marker,
  };
}

// ── Webhook path ─────────────────────────────────────────────────────────────

export type AlertIngestCode =
  | 'unsupported_event'
  | 'bad_payload'
  | 'action_not_ingestable'
  | 'no_repo_link'
  | 'no_project'
  | 'forbidden'
  | 'auth'
  | 'provider_error';

export type AlertIngestResult =
  | { ok: true; ingested: number; deduped: number; auditId: number | null; taskIds: number[] }
  | { ok: false; code: AlertIngestCode; reason: string };

/**
 * Handle one `code_scanning_alert` / `dependabot_alert` webhook delivery.
 *
 * Returns a tagged result in every case — the caller answers 200 regardless so
 * GitHub stops retrying (the webhook route's established contract).
 */
export async function ingestAlertWebhook(
  db: Db,
  event: string,
  payload: Record<string, unknown>,
): Promise<AlertIngestResult> {
  if (!ALERT_EVENTS.has(event)) {
    return { ok: false, code: 'unsupported_event', reason: `event '${event}' is not an alert event` };
  }

  const action = gs(payload, 'action');
  if (!action || !INGESTABLE_ALERT_ACTIONS.has(action)) {
    // Resolved/dismissed alerts are acknowledged, never minted as work.
    return { ok: false, code: 'action_not_ingestable', reason: `action '${action ?? 'missing'}' does not open work` };
  }

  const repoFullName = gs(g(payload, 'repository'), 'full_name');
  if (!repoFullName) return { ok: false, code: 'bad_payload', reason: 'no repository in payload' };

  const alert = g(payload, 'alert');
  const finding = event === 'code_scanning_alert'
    ? codeScanningFinding(alert, repoFullName)
    : dependabotFinding(alert, repoFullName);
  if (!finding) return { ok: false, code: 'bad_payload', reason: 'alert could not be mapped (no alert number?)' };

  const link = await resolveRepoLink(db, repoFullName);
  if (!link) return { ok: false, code: 'no_repo_link', reason: `no project linked to repo '${repoFullName}'` };
  if (link.projectId == null) {
    return { ok: false, code: 'no_project', reason: `repo '${repoFullName}' is linked to a tenant but no project` };
  }

  return recordFindings(db, link.tenantId, link.projectId, [finding], `github:${finding.source}`);
}

// ── Pull-based backfill ──────────────────────────────────────────────────────

/**
 * List a repo's OPEN code-scanning + Dependabot alerts and ingest them.
 *
 * Covers repos whose webhook was never installed (or whose deliveries were
 * dropped) — the same gap `pollPrCiStatus` closes for CI verdicts. Idempotent
 * against the webhook path: both dedupe on the same {@link alertMarker}.
 *
 * Both endpoints require a GitHub App installation token with the
 * `security_events` (or `code_scanning_alerts` / `vulnerability_alerts`) read
 * permission, or a PAT with the `security_events` scope. That permission is very
 * commonly absent, so a 403 is an EXPECTED steady state, not an error worth
 * throwing: it comes back as `code:'forbidden'` for the caller to surface as a
 * setup hint. Likewise a repo with the feature simply disabled answers 404, which
 * we treat as "nothing to ingest" rather than a failure.
 */
export async function ingestOpenAlertsForRepo(
  env: Env,
  db: Db,
  tenantId: number,
  repoId: string,
  opts: { fetchFn?: typeof fetch } = {},
): Promise<AlertIngestResult> {
  const secret =
    (env as { INTEGRATION_ENCRYPTION_SECRET?: string }).INTEGRATION_ENCRYPTION_SECRET ??
    (env as { JWT_SECRET?: string }).JWT_SECRET ?? '';

  const auth = await resolveRepoAuth(env, db, secret, tenantId, repoId);
  if (!auth.ok) return { ok: false, code: 'auth', reason: auth.error };

  const { coords, token, repo } = auth.auth;
  if (repo.provider !== 'github') {
    return { ok: false, code: 'unsupported_event', reason: `alerts are GitHub-only; repo is '${repo.provider}'` };
  }
  const repoFullName = `${coords.owner}/${coords.repo}`;

  const cs = await listAlerts(coords, token, '/code-scanning/alerts?state=open&per_page=100', opts.fetchFn);
  const db_ = await listAlerts(coords, token, '/dependabot/alerts?state=open&per_page=100', opts.fetchFn);

  // Forbidden on BOTH surfaces means the credential genuinely lacks the scope —
  // worth telling the caller. Forbidden on one is reported through the other's
  // success, since the two permissions are granted independently.
  if (cs.code === 'forbidden' && db_.code === 'forbidden') {
    return {
      ok: false,
      code: 'forbidden',
      reason:
        `the credential for ${repoFullName} lacks the 'security_events' permission ` +
        `(GitHub App: Code scanning alerts + Dependabot alerts = Read; PAT: security_events scope)`,
    };
  }
  if (cs.code === 'error' && db_.code === 'error') {
    return { ok: false, code: 'provider_error', reason: cs.reason ?? db_.reason ?? 'GitHub alert listing failed' };
  }

  const findings: AlertFinding[] = [
    ...cs.alerts.map((a) => codeScanningFinding(a, repoFullName)),
    ...db_.alerts.map((a) => dependabotFinding(a, repoFullName)),
  ].filter((f): f is AlertFinding => f !== null);

  return recordFindings(db, tenantId, repo.projectId, findings, 'github:alert-backfill');
}

type ListOutcome = { alerts: unknown[]; code: 'ok' | 'forbidden' | 'absent' | 'error'; reason?: string };

async function listAlerts(
  coords: GitHubCoords,
  token: string,
  suffix: string,
  fetchFn?: typeof fetch,
): Promise<ListOutcome> {
  const res = await githubRequest<unknown[]>({ coords, token, path: repoPath(coords, suffix), fetchFn });
  if (res.ok) return { alerts: Array.isArray(res.data) ? res.data : [], code: 'ok' };
  if (res.status === 403) return { alerts: [], code: 'forbidden', reason: res.reason };
  // 404 = the feature is off for this repo (or advanced security isn't enabled).
  // Nothing to ingest is not a failure.
  if (res.status === 404) return { alerts: [], code: 'absent', reason: res.reason };
  return { alerts: [], code: 'error', reason: res.reason };
}

// ── Shared write path ────────────────────────────────────────────────────────

/**
 * Dedupe, then push each surviving finding through the SAME
 * `SecurityAuditService` pipeline the Security agent uses, wrapped in one audit
 * run so the tickets roll up on the existing audit surface.
 *
 * No audit row is opened when everything deduped — an empty ledger entry per
 * webhook redelivery would be noise.
 */
async function recordFindings(
  db: Db,
  tenantId: number,
  projectId: number,
  findings: AlertFinding[],
  agentRef: string,
): Promise<AlertIngestResult> {
  if (findings.length === 0) {
    return { ok: true, ingested: 0, deduped: 0, auditId: null, taskIds: [] };
  }

  const seen = await openAlertMarkers(db, projectId);
  const fresh: AlertFinding[] = [];
  for (const f of findings) {
    const key = f.marker.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); // also collapses duplicates inside a single batch
    fresh.push(f);
  }

  const deduped = findings.length - fresh.length;
  if (fresh.length === 0) return { ok: true, ingested: 0, deduped, auditId: null, taskIds: [] };

  const svc = new SecurityAuditService(db);
  let auditId: number;
  try {
    auditId = await svc.startAudit(tenantId, { projectId, agentRef, trigger: 'cron' });
  } catch (e) {
    return { ok: false, code: 'no_project', reason: (e as Error).message };
  }

  const taskIds: number[] = [];
  for (const f of fresh) {
    try {
      const rec = await svc.recordFinding(tenantId, {
        auditId,
        title: f.title,
        detail: f.detail,
        severity: f.severity,
        tsc: 'security',
        location: f.location,
        recommendation: f.recommendation,
      });
      taskIds.push(rec.taskId);
    } catch (e) {
      // One bad finding must not abandon the rest (or the audit row).
      console.warn(`[githubAlerts] failed to record ${f.marker}: ${(e as Error).message}`);
    }
  }

  await svc.finishAudit(tenantId, auditId, {
    summary: `Ingested ${taskIds.length} open GitHub security alert(s) from ${agentRef}` +
      (deduped ? ` (${deduped} already tracked)` : ''),
    status: 'complete',
  }).catch(() => {});

  return { ok: true, ingested: taskIds.length, deduped, auditId, taskIds };
}
