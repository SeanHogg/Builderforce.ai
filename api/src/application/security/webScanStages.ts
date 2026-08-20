/**
 * webScanStages — the stage vocabulary of a web security scan, and the PURE rules
 * for merging a stage's result into a scan run.
 *
 * WHY A SCAN HAS STAGES AT ALL
 * A scan used to be one thing: whatever the Worker could observe. Two checks a real
 * security scanner performs are not observable from a Worker — the peer TLS
 * certificate (no socket) and a CVE lookup (no advisory feed) — so they were simply
 * absent. Absent is the dangerous state: a report with no TLS findings reads exactly
 * like a report from a site with a perfect certificate. Naming the stages makes the
 * difference legible: every scan result says which stages RAN, which were REQUESTED,
 * and which did NOT run and why. A stage is never silently omitted.
 *
 * IDEMPOTENCE. The container stages report back asynchronously and may be retried
 * (container restart, network blip, a redelivered callback). {@link mergeStageReport}
 * is the rule that makes a retry harmless: a stage that has already reported `ran`
 * for a given audit is not recorded twice, so a retried container run cannot double
 * up the findings. That is enforced here, on the stage identity, rather than left to
 * the finding-marker dedupe alone — marker dedupe only looks at OPEN tickets, so a
 * finding whose ticket had been closed would come back as a fresh one on every retry.
 *
 * PURE by construction: no DB, no clock beyond an injected timestamp, no network.
 */

/** The stages that cannot run inside the Worker and are observed from a container. */
export const WEB_SCAN_STAGE_IDS = ['tls', 'cve'] as const;
export type WebScanStageId = (typeof WEB_SCAN_STAGE_IDS)[number];

/**
 * What happened to one stage:
 *   'ran'       — it executed and its findings are filed in this audit;
 *   'requested' — dispatched to the container, result not back yet;
 *   'not_run'   — it did not execute, and `reason` says why (never left blank).
 */
export type WebScanStageStatus = 'ran' | 'requested' | 'not_run';

/** One stage's line in the scan result. Persisted as jsonb on the audit row. */
export interface WebScanStageReport {
  stage: WebScanStageId;
  status: WebScanStageStatus;
  /** Required whenever the status is not 'ran'. Rendered to the user verbatim. */
  reason?: string;
  /** How many findings the stage contributed. 0 is a real answer for a clean stage. */
  findingCount: number;
  /** ISO timestamp of the last transition, for the panel's "as of". */
  observedAt?: string;
}

/** Human labels for the stage ids, used in run summaries (not the UI, which localizes). */
export const WEB_SCAN_STAGE_LABEL: Record<WebScanStageId, string> = {
  tls: 'TLS certificate',
  cve: 'CVE fingerprint',
};

/** True for a value that is a known stage id — the guard every parse path needs. */
export function isWebScanStageId(v: unknown): v is WebScanStageId {
  return typeof v === 'string' && (WEB_SCAN_STAGE_IDS as readonly string[]).includes(v);
}

/**
 * Which stage OWNS a finding's check id, or null when the Worker-side scan owns it.
 *
 * This is what keeps the deterministic auto-close honest across two runtimes. A
 * re-scan closes any ticket whose finding it no longer raises — sound, because the
 * Worker's checks are deterministic. But the Worker never raises `tls-cert-expiring`
 * at all: that finding comes from the container, minutes later. Without this
 * ownership test the re-scan would close every TLS and CVE ticket the moment it
 * started, and the container would re-file them seconds afterwards — a ticket
 * churning closed/open on every scan, losing its comments and its assignee each time.
 * A stage's findings are therefore only ever closed by that stage's own report.
 */
export function stageOfCheckId(checkId: string): WebScanStageId | null {
  const id = checkId.trim().toLowerCase();
  for (const stage of WEB_SCAN_STAGE_IDS) {
    if (id === stage || id.startsWith(`${stage}-`)) return stage;
  }
  return null;
}

/** A stage that did not run, carrying the reason it did not. */
export function stageNotRun(stage: WebScanStageId, reason: string, at?: string): WebScanStageReport {
  return { stage, status: 'not_run', reason, findingCount: 0, observedAt: at };
}

/** A stage handed to the container, whose result will arrive through the ingest seam. */
export function stageRequested(stage: WebScanStageId, at?: string): WebScanStageReport {
  return { stage, status: 'requested', reason: 'dispatched to the container runtime; awaiting its result', findingCount: 0, observedAt: at };
}

/** A stage that executed. `findingCount` of 0 means "ran and found nothing". */
export function stageRan(stage: WebScanStageId, findingCount: number, reason?: string, at?: string): WebScanStageReport {
  return { stage, status: 'ran', findingCount, reason, observedAt: at };
}

/** The full set of stage reports for a scan where the container was unavailable. */
export function allStagesNotRun(reason: string, at?: string): WebScanStageReport[] {
  return WEB_SCAN_STAGE_IDS.map((s) => stageNotRun(s, reason, at));
}

/** The full set of stage reports for a scan whose container dispatch succeeded. */
export function allStagesRequested(at?: string): WebScanStageReport[] {
  return WEB_SCAN_STAGE_IDS.map((s) => stageRequested(s, at));
}

/**
 * Read stage reports off a persisted jsonb value. Total: anything unrecognised
 * degrades to an empty list rather than throwing, because a scan history page must
 * never 500 on one malformed legacy row (rows written before the column existed
 * carry `null`, and they are the common case, not an error).
 */
export function parseStageReports(raw: unknown): WebScanStageReport[] {
  const value = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!Array.isArray(value)) return [];
  const out: WebScanStageReport[] = [];
  for (const entry of value) {
    const e = entry as Partial<WebScanStageReport>;
    if (!isWebScanStageId(e?.stage)) continue;
    const status: WebScanStageStatus =
      e.status === 'ran' || e.status === 'requested' || e.status === 'not_run' ? e.status : 'not_run';
    out.push({
      stage: e.stage,
      status,
      reason: typeof e.reason === 'string' ? e.reason : undefined,
      findingCount: typeof e.findingCount === 'number' && e.findingCount >= 0 ? e.findingCount : 0,
      observedAt: typeof e.observedAt === 'string' ? e.observedAt : undefined,
    });
  }
  return out;
}

function safeJson(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return null; }
}

/** The outcome of folding one incoming stage report into a scan's existing set. */
export interface StageMergeResult {
  /** The full stage list to persist. */
  stages: WebScanStageReport[];
  /**
   * False when the incoming report was REJECTED as a duplicate — the stage had
   * already reported `ran`. The caller uses this to skip recording findings, which
   * is what makes a retried container run not double-file its tickets.
   */
  accepted: boolean;
  /** Why an incoming report was rejected, for the caller's telemetry. */
  rejectedReason?: string;
}

/**
 * Fold one stage report into a scan's stage list. PURE.
 *
 * The rule that matters: a stage already recorded as `ran` is TERMINAL for that
 * audit. A second `ran` for the same stage is a retry (a redelivered callback, a
 * container that restarted after posting) and is refused, so its findings are never
 * recorded twice. Everything else — a `requested` becoming `ran`, a `requested`
 * becoming `not_run` because the stage failed inside the container — is accepted and
 * replaces the earlier entry in place, so a stage never appears twice in the list.
 */
export function mergeStageReport(
  existing: WebScanStageReport[],
  incoming: WebScanStageReport,
): StageMergeResult {
  const prior = existing.find((s) => s.stage === incoming.stage);
  if (prior?.status === 'ran') {
    return {
      stages: existing,
      accepted: false,
      rejectedReason: `stage '${incoming.stage}' already reported for this scan`,
    };
  }
  const stages = existing.filter((s) => s.stage !== incoming.stage);
  stages.push(incoming);
  // Stable order so the panel never re-shuffles rows between polls.
  stages.sort((a, b) => WEB_SCAN_STAGE_IDS.indexOf(a.stage) - WEB_SCAN_STAGE_IDS.indexOf(b.stage));
  return { stages, accepted: true };
}

/**
 * One sentence naming what ran and what did not — appended to the audit summary so
 * the run's own record, not just the live panel, states its coverage. A scan whose
 * summary says only "12 issues found" invites the reader to assume all checks ran.
 */
export function describeStages(stages: WebScanStageReport[]): string {
  if (stages.length === 0) return '';
  const parts = stages.map((s) => {
    const label = WEB_SCAN_STAGE_LABEL[s.stage];
    if (s.status === 'ran') return `${label}: ran (${s.findingCount} finding(s))`;
    if (s.status === 'requested') return `${label}: requested`;
    return `${label}: not run — ${s.reason ?? 'no reason recorded'}`;
  });
  return `Stages — ${parts.join('; ')}.`;
}
