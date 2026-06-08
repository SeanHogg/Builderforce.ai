/**
 * GitHub webhook handler — /api/webhooks/github
 *
 * Receives GitHub App or repository webhook events and auto-dispatches
 * labelled issues as BuilderForce Agents tasks.
 *
 * SETUP:
 *   1. In GitHub, create a webhook (App or repo level) pointing to:
 *        https://api.builderforce.ai/api/webhooks/github
 *      Content type: application/json
 *      Events: Issues
 *   2. Set the webhook secret, then:
 *        wrangler secret put GITHUB_WEBHOOK_SECRET
 *   3. Link your Builderforce project to a GitHub repo (set sourceControlRepoFullName
 *      on the project) — the webhook matches repos to projects by this field.
 *
 * DISPATCH TRIGGER:
 *   An issue is dispatched as a task when:
 *     - action = "opened"   (all new issues)
 *     - action = "labeled"  AND the added label name is "coderclaw" or "ai-task"
 *
 * Each GitHub issue only creates one task (idempotent via githubIssueNumber + projectId unique check).
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { projects, tasks, agentHosts } from '../../infrastructure/database/schema';
import { verifyHmacSignature } from '../../application/workflow/verifySignature';
import { ingestRepoCiEvent, type RepoCiEvent } from '../../application/ci/ingestRepoCiEvent';

/** Labels that trigger auto-dispatch. Lower-cased for comparison. */
const DISPATCH_LABELS = new Set(['coderclaw', 'ai-task', 'host', 'ai']);

/** GitHub CI/deploy events we feed back to the originating cloud execution. */
const CI_EVENTS = new Set(['check_suite', 'check_run', 'workflow_run', 'deployment_status', 'status']);

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
  if (event === 'check_suite' || event === 'check_run') {
    const cs = (event === 'check_suite' ? p.check_suite : get(p.check_run, 'check_suite')) as Record<string, unknown> | undefined;
    const run = p.check_run as Record<string, unknown> | undefined;
    return { eventType: event, branch: str(get(cs, 'head_branch')), sha: str(get(cs, 'head_sha') ?? get(run, 'head_sha')),
      outcome: toOutcome(str(get(cs, 'conclusion') ?? get(run, 'conclusion'))), rawState: str(get(cs, 'conclusion') ?? get(run, 'conclusion')), targetUrl: str(get(run, 'html_url')) };
  }
  if (event === 'workflow_run') {
    const w = p.workflow_run as Record<string, unknown> | undefined;
    return { eventType: event, branch: str(get(w, 'head_branch')), sha: str(get(w, 'head_sha')),
      outcome: toOutcome(str(get(w, 'conclusion'))), rawState: str(get(w, 'conclusion') ?? get(w, 'status')), targetUrl: str(get(w, 'html_url')) };
  }
  if (event === 'deployment_status') {
    const dep = p.deployment as Record<string, unknown> | undefined;
    const ds = p.deployment_status as Record<string, unknown> | undefined;
    return { eventType: event, branch: str(get(dep, 'ref')), sha: str(get(dep, 'sha')),
      outcome: toOutcome(str(get(ds, 'state'))), rawState: str(get(ds, 'state')), targetUrl: str(get(ds, 'target_url') ?? get(ds, 'log_url')) };
  }
  if (event === 'status') {
    const branches = Array.isArray(p.branches) ? (p.branches as Array<Record<string, unknown>>) : [];
    return { eventType: event, branch: str(get(branches[0], 'name')), sha: str(p.sha),
      outcome: toOutcome(str(p.state)), rawState: str(p.state), targetUrl: str(p.target_url) };
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

export function createGitHubWebhookRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

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
      return c.json({ received: true, ...res });
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
