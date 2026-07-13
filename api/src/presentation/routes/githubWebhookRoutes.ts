/**
 * GitHub webhook handler — /api/webhooks/github
 *
 * Three jobs, keyed off X-GitHub-Event:
 *   - CI/deploy events → feed build/deploy results back to the cloud execution
 *     (and auto-fix on failure).
 *   - push / pull_request / pull_request_review → INGEST engineering activity into
 *     activity_events (the producer side of the consolidation surface): commits,
 *     PRs, reviews — attributed to a contributor (auto-created on first sight) and a
 *     project (via the connected repo). Issues are ingested inline below too.
 *   - issues → auto-dispatch labelled/opened issues as BuilderForce Agents tasks.
 *
 * SETUP:
 *   1. In GitHub, create a webhook (App or repo level) pointing to:
 *        https://api.builderforce.ai/api/webhooks/github
 *      Content type: application/json
 *      Events: Pushes, Pull requests, Pull request reviews, Issues (+ CI events).
 *   2. Set the webhook secret, then:
 *        wrangler secret put GITHUB_WEBHOOK_SECRET
 *   3. Link the repo to a Builderforce project — either via project_repositories
 *      (Project → Repositories) or the project's sourceControlRepoFullName. The
 *      webhook resolves repo → tenant/project by that link for both ingest + dispatch.
 *
 * DISPATCH TRIGGER:
 *   An issue is dispatched as a task when:
 *     - action = "opened"   (all new issues)
 *     - action = "labeled"  AND the added label name is "coderclaw" or "ai-task"
 *
 * Each GitHub issue only creates one task (idempotent via githubIssueNumber + projectId unique check).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projects, tasks, agentHosts, toolAuditEvents } from '../../infrastructure/database/schema';
import { verifyHmacSignature } from '../../application/workflow/verifySignature';
import { ingestRepoCiEvent, AUTOFIX_DISPATCH_EVENT, type RepoCiEvent, type AutoFixIntent } from '../../application/ci/ingestRepoCiEvent';
import { dispatchCloudRunForTask } from './runtimeRoutes';
import type { RuntimeService } from '../../application/runtime/RuntimeService';
import { ingestForRepo, type IngestEvent } from '../../application/contributors/activityIngest';

/** Labels that trigger auto-dispatch. Lower-cased for comparison. */
const DISPATCH_LABELS = new Set(['coderclaw', 'ai-task', 'host', 'ai']);

/** GitHub CI/deploy events we feed back to the originating cloud execution. */
const CI_EVENTS = new Set(['check_suite', 'check_run', 'workflow_run', 'deployment_status', 'status']);

/** Engineering-activity events we ingest into activity_events (the producer side
 *  of the consolidation surface): commits, PR lifecycle, reviews. Issues are
 *  ingested inline alongside the existing issue→task dispatch. */
const ACTIVITY_EVENTS = new Set(['push', 'pull_request', 'pull_request_review']);

// ── GitHub payload → normalized activity events ──────────────────────────────
// Loose accessors so a missing/odd field degrades to a skipped event, never a throw.
const g = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const gs = (o: unknown, k: string): string | null => { const v = g(o, k); return typeof v === 'string' ? v : null; };
const gn = (o: unknown, k: string): number | null => { const v = g(o, k); return typeof v === 'number' ? v : null; };

/** "owner/repo" + repo short name from a webhook payload's repository object. */
function repoNames(p: Record<string, unknown>): { full: string | null; short: string | null } {
  const repo = g(p, 'repository');
  return { full: gs(repo, 'full_name'), short: gs(repo, 'name') };
}

/** push → one 'commit' event per commit on a branch push (tag pushes skipped). */
export function commitEvents(p: Record<string, unknown>): IngestEvent[] {
  const ref = gs(p, 'ref');
  if (ref && !ref.startsWith('refs/heads/')) return [];
  const { full, short } = repoNames(p);
  const commits = Array.isArray(g(p, 'commits')) ? (g(p, 'commits') as Array<Record<string, unknown>>) : [];
  return commits.map((ci) => {
    const author = g(ci, 'author');
    const login = gs(author, 'username');
    const email = gs(author, 'email');
    const message = gs(ci, 'message') ?? '';
    return {
      eventType: 'commit',
      externalId: gs(ci, 'id'),                       // commit SHA
      contributorExternalId: login ?? email,          // GH login, else email
      authorDisplayName: gs(author, 'name'),
      authorEmail: email,
      repositoryName: short,
      repositoryFullName: full,
      title: (message.split('\n')[0] ?? '').slice(0, 500),
      url: gs(ci, 'url'),
      occurredAt: gs(ci, 'timestamp') ?? new Date().toISOString(),
    } satisfies IngestEvent;
  });
}

/** pull_request → pr_opened / pr_merged / pr_closed (with merge cycle time). */
export function pullRequestEvents(p: Record<string, unknown>): IngestEvent[] {
  const action = gs(p, 'action');
  const pr = g(p, 'pull_request');
  if (!pr) return [];
  let eventType: IngestEvent['eventType'];
  if (action === 'opened' || action === 'reopened') eventType = 'pr_opened';
  else if (action === 'closed') eventType = g(pr, 'merged') ? 'pr_merged' : 'pr_closed';
  else return [];
  const { full, short } = repoNames(p);
  const user = g(pr, 'user');
  const createdAt = gs(pr, 'created_at');
  const mergedAt = gs(pr, 'merged_at');
  const occurredAt =
    (eventType === 'pr_opened' ? createdAt : (mergedAt ?? gs(pr, 'closed_at') ?? gs(pr, 'updated_at'))) ??
    new Date().toISOString();
  const cycleTimeHours =
    eventType === 'pr_merged' && mergedAt && createdAt
      ? Math.max(0, Math.round((new Date(mergedAt).getTime() - new Date(createdAt).getTime()) / 3_600_000))
      : null;
  const number = gn(p, 'number') ?? gn(pr, 'number');
  return [{
    eventType,
    externalId: number != null ? `pr-${number}` : null,
    contributorExternalId: gs(user, 'login'),
    authorDisplayName: gs(user, 'login'),
    authorAvatarUrl: gs(user, 'avatar_url'),
    repositoryName: short,
    repositoryFullName: full,
    title: gs(pr, 'title'),
    url: gs(pr, 'html_url'),
    linesAdded: gn(pr, 'additions'),
    linesRemoved: gn(pr, 'deletions'),
    filesChanged: gn(pr, 'changed_files'),
    cycleTimeHours,
    occurredAt,
  }];
}

/** pull_request_review (submitted) → pr_reviewed. */
export function reviewEvents(p: Record<string, unknown>): IngestEvent[] {
  if (gs(p, 'action') !== 'submitted') return [];
  const r = g(p, 'review');
  if (!r) return [];
  const { full, short } = repoNames(p);
  const user = g(r, 'user');
  const id = gn(r, 'id');
  const state = gs(r, 'state');
  return [{
    eventType: 'pr_reviewed',
    externalId: id != null ? `review-${id}` : null,
    contributorExternalId: gs(user, 'login'),
    authorDisplayName: gs(user, 'login'),
    authorAvatarUrl: gs(user, 'avatar_url'),
    repositoryName: short,
    repositoryFullName: full,
    title: state ? `Review: ${state}` : 'Review',
    url: gs(r, 'html_url'),
    occurredAt: gs(r, 'submitted_at') ?? new Date().toISOString(),
  }];
}

/** issues (opened/closed) → issue_created / issue_resolved. */
export function issueEvents(p: Record<string, unknown>): IngestEvent[] {
  const action = gs(p, 'action');
  const issue = g(p, 'issue');
  if (!issue) return [];
  let eventType: IngestEvent['eventType'];
  if (action === 'opened') eventType = 'issue_created';
  else if (action === 'closed') eventType = 'issue_resolved';
  else return [];
  const { full, short } = repoNames(p);
  const user = g(issue, 'user');
  const number = gn(issue, 'number');
  return [{
    eventType,
    externalId: number != null ? `issue-${number}` : null,
    contributorExternalId: gs(user, 'login'),
    authorDisplayName: gs(user, 'login'),
    authorAvatarUrl: gs(user, 'avatar_url'),
    repositoryName: short,
    repositoryFullName: full,
    title: gs(issue, 'title'),
    url: gs(issue, 'html_url'),
    occurredAt: (action === 'opened' ? gs(issue, 'created_at') : gs(issue, 'closed_at') ?? gs(issue, 'updated_at')) ?? new Date().toISOString(),
  }];
}

/** Ingest normalized GitHub events for the tenant that owns the repo. */
const ingestGithubActivity = (env: Env, db: Db, repoFullName: string, events: IngestEvent[]) =>
  ingestForRepo(env, db, 'github', repoFullName, events);

/** Map a provider conclusion/state to our normalized outcome. */
function toOutcome(s: string | null | undefined): RepoCiEvent['outcome'] {
  const v = (s ?? '').toLowerCase();
  if (v === 'success') return 'success';
  if (['failure', 'error', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(v)) return 'failure';
  if (!v) return null;
  return 'pending';
}

/** Normalize the assorted CI/deploy payloads to a single shape for correlation. */
function normalizeCiEvent(event: string, p: Record<string, unknown>): RepoCiEvent | null {
  const get = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  if (event === 'check_suite' || event === 'check_run') {
    const cs = (event === 'check_suite' ? p.check_suite : get(p.check_run, 'check_suite')) as Record<string, unknown> | undefined;
    const run = p.check_run as Record<string, unknown> | undefined;
    return { eventType: event, branch: str(get(cs, 'head_branch')), sha: str(get(cs, 'head_sha') ?? get(run, 'head_sha')),
      outcome: toOutcome(str(get(cs, 'conclusion') ?? get(run, 'conclusion'))), rawState: str(get(cs, 'conclusion') ?? get(run, 'conclusion')), targetUrl: str(get(run, 'html_url')), runId: null };
  }
  if (event === 'workflow_run') {
    const w = p.workflow_run as Record<string, unknown> | undefined;
    return { eventType: event, branch: str(get(w, 'head_branch')), sha: str(get(w, 'head_sha')),
      outcome: toOutcome(str(get(w, 'conclusion'))), rawState: str(get(w, 'conclusion') ?? get(w, 'status')), targetUrl: str(get(w, 'html_url')), runId: num(get(w, 'id')) };
  }
  if (event === 'deployment_status') {
    const dep = p.deployment as Record<string, unknown> | undefined;
    const ds = p.deployment_status as Record<string, unknown> | undefined;
    return { eventType: event, branch: str(get(dep, 'ref')), sha: str(get(dep, 'sha')),
      outcome: toOutcome(str(get(ds, 'state'))), rawState: str(get(ds, 'state')), targetUrl: str(get(ds, 'target_url') ?? get(ds, 'log_url')), runId: null };
  }
  if (event === 'status') {
    const branches = Array.isArray(p.branches) ? (p.branches as Array<Record<string, unknown>>) : [];
    return { eventType: event, branch: str(get(branches[0], 'name')), sha: str(p.sha),
      outcome: toOutcome(str(p.state)), rawState: str(p.state), targetUrl: str(p.target_url), runId: null };
  }
  return null;
}

interface GitHubIssuePayload {
  action: string;
  issue: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    labels: Array<{ name: string }>;
    state: string;
    user: { login: string };
  };
  label?: { name: string };
  repository: {
    full_name: string;
    html_url: string;
  };
  installation?: { id: number };
}

export function createGitHubWebhookRoutes(db: Db, runtimeService: RuntimeService): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  /**
   * A build failed (pre-merge PR branch or post-merge deploy) → dispatch an auto-fix
   * run for the task (the agent fixes the build → updated/new approval-gated PR). The
   * loop-guard lives in `ingestRepoCiEvent` (it only returns an intent under the
   * attempt cap); here we just start the run and record the `autofix.dispatch` event
   * the guard counts.
   */
  const dispatchAutoFix = (c: Context<HonoEnv>, intent: AutoFixIntent): void => {
    c.executionCtx.waitUntil((async () => {
      try {
        const executionId = await dispatchCloudRunForTask(
          c.env as Env, db, runtimeService,
          (p) => c.executionCtx.waitUntil(p),
          { taskId: intent.taskId, tenantId: intent.tenantId, payload: intent.payload, submittedBy: 'system:autofix' },
        );
        if (executionId != null) {
          await db.insert(toolAuditEvents).values({
            tenantId: intent.tenantId, agentHostId: null, cloudAgentRef: null,
            executionId, sessionKey: `exec:${executionId}`,
            toolName: AUTOFIX_DISPATCH_EVENT, category: 'ci',
            args: JSON.stringify({ taskId: intent.taskId, attempt: intent.attempt }),
            result: `auto-fix run dispatched (attempt ${intent.attempt})`, ts: new Date(),
          }).catch(() => { /* telemetry best-effort */ });
        }
      } catch { /* webhook stays 200 — never let a dispatch failure retry the hook */ }
    })());
  };

  /**
   * POST /github
   * GitHub posts here for subscribed events. Signature verification is required.
   * Body must be read as raw text — do not use c.req.json() before verification.
   */
  router.post('/github', async (c) => {
    const secret = c.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      // If not configured, acknowledge but skip processing
      return c.json({ received: true, processed: false, reason: 'GITHUB_WEBHOOK_SECRET not configured' });
    }

    const rawBody = await c.req.text();
    const sigHeader = c.req.header('X-Hub-Signature-256') ?? '';

    const valid = await verifyHmacSignature(rawBody, sigHeader, secret);
    if (!valid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const event = c.req.header('X-GitHub-Event');

    // CI/deploy feedback: correlate a build/deploy result back to the cloud
    // execution that pushed the `builderforce/task-<id>` branch and record it so
    // the run's Logs/Timeline show the outcome (and optionally merge-on-green).
    if (event && CI_EVENTS.has(event)) {
      let p: Record<string, unknown>;
      try { p = JSON.parse(rawBody) as Record<string, unknown>; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
      const norm = normalizeCiEvent(event, p);
      if (!norm) return c.json({ received: true, processed: false, reason: `event '${event}' not normalized` });
      const secret = c.env.INTEGRATION_ENCRYPTION_SECRET ?? c.env.JWT_SECRET ?? '';
      const res = await ingestRepoCiEvent(db, c.env as Env, secret, norm);
      // A build failed (pre-merge PR branch or post-merge deploy) and is under the
      // attempt cap → kick off a fix run so the agent fixes the build it broke.
      if (res.autoFix) dispatchAutoFix(c, res.autoFix);
      return c.json({ received: true, ...res, autoFix: res.autoFix ? { dispatched: true, attempt: res.autoFix.attempt } : undefined });
    }

    // Engineering-activity ingestion: connecting a repo makes its commits / PRs /
    // reviews flow into activity_events, attributed to a contributor (auto-created
    // on first sight) and a project, for the consolidation + rollup surfaces.
    if (event && ACTIVITY_EVENTS.has(event)) {
      let p: Record<string, unknown>;
      try { p = JSON.parse(rawBody) as Record<string, unknown>; } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
      const { full } = repoNames(p);
      if (!full) return c.json({ received: true, processed: false, reason: 'no repository in payload' });
      const events =
        event === 'push' ? commitEvents(p)
        : event === 'pull_request' ? pullRequestEvents(p)
        : reviewEvents(p);
      const out = await ingestGithubActivity(c.env as Env, db, full, events);
      if (!out) {
        return c.json({ received: true, processed: false, reason: `no project linked to repo '${full}'` });
      }
      return c.json({ received: true, processed: true, inserted: out.inserted, skipped: out.skipped });
    }

    if (event !== 'issues') {
      // Acknowledge non-issue events without processing
      return c.json({ received: true, processed: false, reason: `event '${event}' not handled` });
    }

    let payload: GitHubIssuePayload;
    try {
      payload = JSON.parse(rawBody) as GitHubIssuePayload;
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { action, issue, repository } = payload;

    // Ingest issue activity (opened → issue_created, closed → issue_resolved) for
    // the consolidation surface — independent of, and in addition to, task dispatch
    // below (which only fires for labelled/open issues). Best-effort: a no-link or
    // non-tracked action just yields zero events.
    try {
      const issuePayload = JSON.parse(rawBody) as Record<string, unknown>;
      await ingestGithubActivity(c.env as Env, db, repository.full_name, issueEvents(issuePayload));
    } catch { /* activity ingest is best-effort; never block dispatch */ }

    // Only dispatch on 'opened' or when a dispatch label is added
    const isOpen = action === 'opened';
    const isLabelDispatch =
      action === 'labeled' &&
      payload.label != null &&
      DISPATCH_LABELS.has(payload.label.name.toLowerCase());

    if (!isOpen && !isLabelDispatch) {
      return c.json({ received: true, processed: false, reason: `action '${action}' not dispatched` });
    }

    // Skip closed/merged issues
    if (issue.state !== 'open') {
      return c.json({ received: true, processed: false, reason: 'issue is not open' });
    }

    // Find the project linked to this repo
    const [project] = await db
      .select({ id: projects.id, tenantId: projects.tenantId })
      .from(projects)
      .where(eq(projects.sourceControlRepoFullName, repository.full_name))
      .limit(1);

    if (!project) {
      return c.json({
        received: true,
        processed: false,
        reason: `no project linked to repo '${repository.full_name}'`,
      });
    }

    // Idempotency: skip if a task for this issue already exists in this project
    const [existing] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, project.id),
          eq(tasks.githubIssueNumber, issue.number),
        ),
      )
      .limit(1);

    if (existing) {
      return c.json({ received: true, processed: false, reason: 'task already exists for this issue' });
    }

    // Find the tenant's default agentHost for auto-assignment (optional)
    const [tenantRow] = await db
      .select({ defaultAgentHostId: agentHosts.id })
      .from(agentHosts)
      .where(
        and(
          eq(agentHosts.tenantId, project.tenantId),
          eq(agentHosts.status, 'active'),
        ),
      )
      .limit(1);

    const assignedAgentHostId = tenantRow?.defaultAgentHostId ?? null;

    // Build task key: GH-<repo>-<number> (truncated)
    const repoSlug = repository.full_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 30);
    const taskKey = `GH-${repoSlug}-${issue.number}`;

    // Build description from issue body + metadata
    const body = issue.body?.trim() ?? '';
    const description = [
      `**GitHub Issue:** [#${issue.number}](${issue.html_url})`,
      `**Opened by:** @${issue.user.login}`,
      `**Repository:** ${repository.full_name}`,
      '',
      body || '_No description provided._',
    ].join('\n');

    const [inserted] = await db
      .insert(tasks)
      .values({
        projectId: project.id,
        key: taskKey,
        title: issue.title,
        description,
        status: assignedAgentHostId ? 'ready' : 'backlog',
        priority: 'medium',
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.html_url,
        assignedAgentHostId,
      })
      .returning({ id: tasks.id, key: tasks.key });

    return c.json({
      received: true,
      processed: true,
      taskId: inserted?.id,
      taskKey: inserted?.key,
      assignedAgentHostId,
    }, 201);
  });

  return router;
}
