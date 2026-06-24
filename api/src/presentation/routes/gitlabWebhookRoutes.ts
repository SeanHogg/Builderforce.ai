/**
 * GitLab webhook handler — /api/webhooks/gitlab
 *
 * Ingests engineering activity (pushes, merge requests, issues) from a connected
 * GitLab project into activity_events — the GitLab twin of the GitHub webhook, so
 * a GitLab repo's activity flows live in addition to the cron poller's backfill.
 *
 * SETUP: GitLab project/group → Settings → Webhooks → URL https://api.builderforce.ai/api/webhooks/gitlab,
 * Secret token = GITLAB_WEBHOOK_SECRET (`wrangler secret put GITLAB_WEBHOOK_SECRET`),
 * triggers: Push, Merge request, Issues events. Link the repo to a project
 * (Project → Repositories, or sourceControlRepoFullName = "group/repo").
 */
import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { ingestForRepo, type IngestEvent } from '../../application/contributors/activityIngest';

const g = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const gs = (o: unknown, k: string): string | null => { const v = g(o, k); return typeof v === 'string' ? v : null; };

function projectFullName(p: Record<string, unknown>): string | null {
  const proj = g(p, 'project');
  return gs(proj, 'path_with_namespace');
}
function projectShortName(p: Record<string, unknown>): string | null {
  return gs(g(p, 'project'), 'name');
}

/** push hook → one 'commit' per commit on the pushed branch. */
function pushEvents(p: Record<string, unknown>): IngestEvent[] {
  const ref = gs(p, 'ref');
  if (ref && !ref.startsWith('refs/heads/')) return [];
  const full = projectFullName(p);
  const short = projectShortName(p);
  const commits = Array.isArray(g(p, 'commits')) ? (g(p, 'commits') as Array<Record<string, unknown>>) : [];
  return commits.map((c) => {
    const author = g(c, 'author');
    const email = gs(author, 'email');
    const message = gs(c, 'message') ?? '';
    return {
      eventType: 'commit',
      externalId: gs(c, 'id'),
      contributorExternalId: email,            // GitLab push commits carry email, not username
      authorDisplayName: gs(author, 'name'),
      authorEmail: email,
      repositoryName: short,
      repositoryFullName: full,
      title: (message.split('\n')[0] ?? '').slice(0, 500),
      url: gs(c, 'url'),
      occurredAt: gs(c, 'timestamp') ?? new Date().toISOString(),
    } satisfies IngestEvent;
  });
}

/** merge_request hook → pr_opened / pr_merged / pr_closed by action. */
function mergeRequestEvents(p: Record<string, unknown>): IngestEvent[] {
  const attrs = g(p, 'object_attributes');
  if (!attrs) return [];
  const action = gs(attrs, 'action');
  let eventType: IngestEvent['eventType'];
  if (action === 'open' || action === 'reopen') eventType = 'pr_opened';
  else if (action === 'merge') eventType = 'pr_merged';
  else if (action === 'close') eventType = 'pr_closed';
  else return [];
  const iid = g(attrs, 'iid');
  if (typeof iid !== 'number') return [];
  const user = g(p, 'user');
  const createdAt = gs(attrs, 'created_at');
  const occurredAt = (eventType === 'pr_opened' ? createdAt : gs(attrs, 'updated_at')) ?? new Date().toISOString();
  const cycleTimeHours = eventType === 'pr_merged' && createdAt
    ? Math.max(0, Math.round((new Date(occurredAt).getTime() - new Date(createdAt).getTime()) / 3_600_000))
    : null;
  return [{
    eventType,
    externalId: `mr-${iid}`,
    contributorExternalId: gs(user, 'username'),
    authorDisplayName: gs(user, 'username'),
    authorAvatarUrl: gs(user, 'avatar_url'),
    repositoryName: projectShortName(p),
    repositoryFullName: projectFullName(p),
    title: gs(attrs, 'title'),
    url: gs(attrs, 'url'),
    cycleTimeHours,
    occurredAt,
  }];
}

/** issue hook → issue_created / issue_resolved by action. */
function issueEvents(p: Record<string, unknown>): IngestEvent[] {
  const attrs = g(p, 'object_attributes');
  if (!attrs) return [];
  const action = gs(attrs, 'action');
  let eventType: IngestEvent['eventType'];
  if (action === 'open' || action === 'reopen') eventType = 'issue_created';
  else if (action === 'close') eventType = 'issue_resolved';
  else return [];
  const iid = g(attrs, 'iid');
  if (typeof iid !== 'number') return [];
  const user = g(p, 'user');
  return [{
    eventType,
    externalId: `issue-${iid}`,
    contributorExternalId: gs(user, 'username'),
    authorDisplayName: gs(user, 'username'),
    authorAvatarUrl: gs(user, 'avatar_url'),
    repositoryName: projectShortName(p),
    repositoryFullName: projectFullName(p),
    title: gs(attrs, 'title'),
    url: gs(attrs, 'url'),
    occurredAt: (eventType === 'issue_created' ? gs(attrs, 'created_at') : gs(attrs, 'closed_at') ?? gs(attrs, 'updated_at')) ?? new Date().toISOString(),
  }];
}

export { pushEvents as gitlabPushEvents, mergeRequestEvents as gitlabMergeRequestEvents, issueEvents as gitlabIssueEvents };

export function createGitLabWebhookRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/gitlab', async (c) => {
    const secret = c.env.GITLAB_WEBHOOK_SECRET;
    if (!secret) return c.json({ received: true, processed: false, reason: 'GITLAB_WEBHOOK_SECRET not configured' });
    // GitLab sends the configured secret verbatim in this header (no HMAC).
    if (c.req.header('X-Gitlab-Token') !== secret) return c.json({ error: 'Invalid token' }, 401);

    let p: Record<string, unknown>;
    try { p = (await c.req.json()) as Record<string, unknown>; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

    const event = c.req.header('X-Gitlab-Event');
    const events =
      event === 'Push Hook' ? pushEvents(p)
      : event === 'Merge Request Hook' ? mergeRequestEvents(p)
      : event === 'Issue Hook' ? issueEvents(p)
      : null;
    if (events == null) return c.json({ received: true, processed: false, reason: `event '${event}' not handled` });

    const full = projectFullName(p);
    if (!full) return c.json({ received: true, processed: false, reason: 'no project in payload' });
    const out = await ingestForRepo(c.env as Env, db, 'gitlab', full, events);
    if (!out) return c.json({ received: true, processed: false, reason: `no project linked to repo '${full}'` });
    return c.json({ received: true, processed: true, inserted: out.inserted, skipped: out.skipped });
  });

  return router;
}
