/**
 * Bitbucket Cloud webhook handler — /api/webhooks/bitbucket
 *
 * Ingests engineering activity (pushes, pull requests, issues) from a connected
 * Bitbucket repo into activity_events — the Bitbucket twin of the GitHub webhook,
 * complementing the cron poller's backfill. Commit/PR payload shapes match the
 * REST source, so the pure mappers are reused (DRY).
 *
 * SETUP: Repository → Settings → Webhooks → URL https://api.builderforce.ai/api/webhooks/bitbucket,
 * Secret = BITBUCKET_WEBHOOK_SECRET (`wrangler secret put BITBUCKET_WEBHOOK_SECRET`),
 * triggers: Repository push, Pull request (created/updated/merged/declined), Issue,
 * Build status (created/updated) — the last one drives the CI feedback + auto-fix loop.
 */
import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { verifyHmacSignature } from '../../application/workflow/verifySignature';
import { ingestForRepo, type IngestEvent } from '../../application/contributors/activityIngest';
import { mapBbCommit, mapBbPull } from '../../application/contributors/bitbucketActivitySource';
import type { RepoCiEvent } from '../../application/ci/ingestRepoCiEvent';
import { handleCiEventOutcome } from '../../application/ci/handleCiEventOutcome';
import { resolveBitbucketBranchForCommit } from '../../application/ci/bitbucketBranchForCommit';
import { ciOutcomeDeps } from './ciOutcomeDeps';
import type { RuntimeService } from '../../application/runtime/RuntimeService';

const g = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const gs = (o: unknown, k: string): string | null => { const v = g(o, k); return typeof v === 'string' ? v : null; };

function repoNames(p: Record<string, unknown>): { full: string | null; short: string | null } {
  const repo = g(p, 'repository');
  return { full: gs(repo, 'full_name'), short: gs(repo, 'name') };
}

/** repo:push → commits across all pushed branch changes (reuses the source mapper). */
function pushEvents(p: Record<string, unknown>, full: string, short: string): IngestEvent[] {
  const changes = Array.isArray(g(g(p, 'push'), 'changes')) ? (g(g(p, 'push'), 'changes') as Array<Record<string, unknown>>) : [];
  const out: IngestEvent[] = [];
  for (const ch of changes) {
    const commits = Array.isArray(g(ch, 'commits')) ? (g(ch, 'commits') as Array<Record<string, unknown>>) : [];
    for (const c of commits) { const e = mapBbCommit(c, full, short); if (e) out.push(e); }
  }
  return out;
}

/** pullrequest:* → lifecycle events (reuses the source mapper; state drives type). */
function pullEvents(p: Record<string, unknown>, full: string, short: string): IngestEvent[] {
  const pr = g(p, 'pullrequest');
  return pr ? mapBbPull(pr, full, short) : [];
}

/** issue:created / issue:updated(resolved|closed) → issue_created / issue_resolved. */
function issueEvents(p: Record<string, unknown>, full: string, short: string): IngestEvent[] {
  const issue = g(p, 'issue');
  if (!issue) return [];
  const id = g(issue, 'id');
  if (typeof id !== 'number') return [];
  const state = (gs(issue, 'state') ?? '').toLowerCase();
  const resolved = state === 'resolved' || state === 'closed';
  const reporter = g(issue, 'reporter');
  return [{
    eventType: resolved ? 'issue_resolved' : 'issue_created',
    externalId: `issue-${id}`,
    contributorExternalId: gs(reporter, 'account_id') ?? gs(reporter, 'nickname'),
    authorDisplayName: gs(reporter, 'display_name') ?? gs(reporter, 'nickname'),
    repositoryName: short,
    repositoryFullName: full,
    title: gs(issue, 'title'),
    url: gs(g(g(issue, 'links'), 'html'), 'href'),
    occurredAt: (resolved ? gs(issue, 'updated_on') : gs(issue, 'created_on')) ?? new Date().toISOString(),
  }];
}

// ── CI: commit/build status → RepoCiEvent ────────────────────────────────────

/** Bitbucket commit-status state → the normalized outcome. */
function toOutcome(state: string | null): RepoCiEvent['outcome'] {
  const v = (state ?? '').toUpperCase();
  if (v === 'SUCCESSFUL') return 'success';
  if (v === 'FAILED' || v === 'ERROR') return 'failure';
  if (v === 'INPROGRESS') return 'pending';
  // STOPPED (cancelled) is not a build verdict — not actionable.
  return null;
}

/**
 * `repo:commit_status_created|updated` → {@link RepoCiEvent}. Exported for tests.
 *
 * Bitbucket carries NO numeric run id on a commit status, so `runId` is null and the
 * GitHub default eligibility rule (`runId != null`) would silently make every
 * Bitbucket build failure auto-fix ineligible. A commit status is however already a
 * whole-build verdict — Bitbucket posts one terminal state per build key rather than
 * a stream of per-check events — so we mark terminal states `authoritative` and stay
 * genuinely eligible. The failed-step detail still resolves without a run id:
 * `fetchBuildError` recovers the build number from the status URL.
 *
 * The status `key` identifies the POSTER (one per CI system wired to the repo), so it
 * rides along as `statusKey` — several keys on one commit are one build, and the
 * auto-fix budget de-duplicates on `(sha, key)` rather than spending an attempt each.
 */
export function bitbucketNormalizeCiEvent(p: Record<string, unknown>): RepoCiEvent | null {
  const st = g(p, 'commit_status') ?? g(p, 'build_status');
  if (!st) return null;
  const state = gs(st, 'state');
  const outcome = toOutcome(state);
  return {
    eventType: 'commit_status',
    // `refname` is present on branch builds; without it the branch is resolved from
    // the commit hash via the refs API below (falling back to post-merge sha correlation).
    branch: gs(st, 'refname') ?? gs(g(st, 'commit'), 'refname'),
    sha: gs(g(st, 'commit'), 'hash'),
    outcome,
    rawState: state,
    targetUrl: gs(st, 'url') ?? gs(g(g(st, 'links'), 'self'), 'href'),
    runId: null,
    authoritative: outcome === 'success' || outcome === 'failure',
    statusKey: gs(st, 'key'),
  };
}

export function createBitbucketWebhookRoutes(db: Db, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/bitbucket', async (c) => {
    const secret = c.env.BITBUCKET_WEBHOOK_SECRET;
    if (!secret) return c.json({ received: true, processed: false, reason: 'BITBUCKET_WEBHOOK_SECRET not configured' });

    const rawBody = await c.req.text();
    const valid = await verifyHmacSignature(rawBody, c.req.header('X-Hub-Signature') ?? '', secret);
    if (!valid) return c.json({ error: 'Invalid signature' }, 401);

    let p: Record<string, unknown>;
    try { p = JSON.parse(rawBody) as Record<string, unknown>; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const key = c.req.header('X-Event-Key') ?? '';

    // CI feedback: a build status posted against a commit is Bitbucket's build
    // result — correlate it back to the cloud execution that pushed the ticket
    // branch (build.result telemetry, PR build_status, merge-on-green, auto-fix).
    // The post-ingest half is the shared, provider-independent handler.
    if (key === 'repo:commit_status_created' || key === 'repo:commit_status_updated'
        || key === 'repo:build_status_created' || key === 'repo:build_status_updated') {
      const norm = bitbucketNormalizeCiEvent(p);
      if (!norm) return c.json({ received: true, processed: false, reason: 'commit status not normalized' });
      // No `refname` → the status was posted against a bare commit hash. Ask the refs
      // API which branch that hash heads, so a red PR-branch build still reaches the
      // PRE-merge auto-fix path instead of only post-merge sha correlation. Cached +
      // best-effort: still null → unchanged behaviour (post-merge correlation).
      if (!norm.branch && norm.sha) {
        const full = repoNames(p).full;
        if (full) {
          const env = c.env as Env;
          const credSecret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET ?? '';
          norm.branch = await resolveBitbucketBranchForCommit(db, env, credSecret, full, norm.sha);
        }
      }
      const res = await handleCiEventOutcome(ciOutcomeDeps(c, db, runtimeService), norm, 'bitbucket');
      return c.json({ received: true, ...res, autoFix: res.autoFix ? { dispatched: res.autoFixDispatched, attempt: res.autoFix.attempt } : undefined });
    }

    const { full, short } = repoNames(p);
    if (!full) return c.json({ received: true, processed: false, reason: 'no repository in payload' });

    const events =
      key === 'repo:push' ? pushEvents(p, full, short ?? full)
      : key.startsWith('pullrequest:') ? pullEvents(p, full, short ?? full)
      : key.startsWith('issue:') ? issueEvents(p, full, short ?? full)
      : null;
    if (events == null) return c.json({ received: true, processed: false, reason: `event '${key}' not handled` });

    const out = await ingestForRepo(c.env as Env, db, 'bitbucket', full, events);
    if (!out) return c.json({ received: true, processed: false, reason: `no project linked to repo '${full}'` });
    return c.json({ received: true, processed: true, inserted: out.inserted, skipped: out.skipped });
  });

  return router;
}
