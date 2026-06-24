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
 * triggers: Repository push, Pull request (created/updated/merged/declined), Issue.
 */
import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { verifyHmacSignature } from '../../application/workflow/verifySignature';
import { ingestForRepo, type IngestEvent } from '../../application/contributors/activityIngest';
import { mapBbCommit, mapBbPull } from '../../application/contributors/bitbucketActivitySource';

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

export function createBitbucketWebhookRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/bitbucket', async (c) => {
    const secret = c.env.BITBUCKET_WEBHOOK_SECRET;
    if (!secret) return c.json({ received: true, processed: false, reason: 'BITBUCKET_WEBHOOK_SECRET not configured' });

    const rawBody = await c.req.text();
    const valid = await verifyHmacSignature(rawBody, c.req.header('X-Hub-Signature') ?? '', secret);
    if (!valid) return c.json({ error: 'Invalid signature' }, 401);

    let p: Record<string, unknown>;
    try { p = JSON.parse(rawBody) as Record<string, unknown>; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const { full, short } = repoNames(p);
    if (!full) return c.json({ received: true, processed: false, reason: 'no repository in payload' });

    const key = c.req.header('X-Event-Key') ?? '';
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
