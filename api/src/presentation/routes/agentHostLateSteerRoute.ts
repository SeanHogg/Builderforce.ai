/**
 * POST /api/agent-hosts/:id/late-steers — a self-hosted runtime reports steers it could
 * not deliver because the run had already taken its last turn (`run_finishing`) or was
 * not live on the host (`no_live_run`).
 *
 * The route only authenticates and parses; scoping the report to the host's own run and
 * deciding what HAPPENS to the steers is the one application use case every surface
 * shares (`lateSteerFollowUp.ts`): a follow-up run on the same branch, idempotent on the
 * steer's row id, entitlements standing.
 *
 * Registered onto the agent-host router from here rather than grown into it.
 */
import type { Context, Hono } from 'hono';
import type { Env, HonoEnv } from '../../env';
import { reportHostLateSteers, type LateSteerDeps, type LateSteerReason } from '../../application/runtime/lateSteerFollowUp';
import type { ReportedSteer } from '../../application/runtime/lateSteerStore';
import { parseBody, zJsonObject } from './requestBody';

/** The reasons a HOST may report (the terminal-chokepoint `run_ended` is server-side). */
const HOST_REASONS: readonly LateSteerReason[] = ['run_finishing', 'no_live_run'];
const MAX_STEERS = 50;
const MAX_TEXT = 20_000;

export type LateSteerReport = { executionId: number; reason: LateSteerReason; steers: ReportedSteer[] };

/** Read a host's report off its (already JSON-object) body. Pure, so the accepted wire shape is testable. */
export function parseLateSteerReport(body: unknown): { ok: true; report: LateSteerReport } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as { executionId?: unknown; reason?: unknown; steers?: unknown };
  const executionId = typeof b.executionId === 'number' && Number.isSafeInteger(b.executionId) && b.executionId > 0 ? b.executionId : null;
  if (executionId == null) return { ok: false, error: 'executionId is required' };
  const reason = HOST_REASONS.find((r) => r === b.reason);
  if (!reason) return { ok: false, error: `reason must be one of: ${HOST_REASONS.join(', ')}` };
  const steers: ReportedSteer[] = (Array.isArray(b.steers) ? b.steers : []).slice(0, MAX_STEERS).flatMap((raw) => {
    const s = (raw && typeof raw === 'object' ? raw : {}) as { messageId?: unknown; text?: unknown };
    const text = typeof s.text === 'string' ? s.text.trim().slice(0, MAX_TEXT) : '';
    if (!text) return [];
    const messageId = typeof s.messageId === 'number' && Number.isSafeInteger(s.messageId) && s.messageId > 0 ? s.messageId : undefined;
    return [{ text, ...(messageId != null ? { messageId } : {}) }];
  });
  if (steers.length === 0) return { ok: false, error: 'steers must name at least one steer' };
  return { ok: true, report: { executionId, reason, steers } };
}

export function registerLateSteerRoute<E extends HonoEnv>(
  router: Hono<E>,
  deps: {
    db: LateSteerDeps['db'];
    verifyAgentHostApiKey: (id: number, key?: string) => Promise<{ tenantId: number | string } | null | undefined>;
    extractAgentHostKey: (c: Context<E>) => string | undefined;
  },
): void {
  router.post('/:id/late-steers', async (c) => {
    const agentHostId = Number(c.req.param('id'));
    const agentHost = await deps.verifyAgentHostApiKey(agentHostId, deps.extractAgentHostKey(c));
    if (!agentHost) return c.text('Unauthorized', 401);

    const parsed = parseLateSteerReport(await parseBody(c, zJsonObject));
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const outcome = await reportHostLateSteers(
      { env: c.env as unknown as Env, db: deps.db, waitUntil: (p) => c.executionCtx.waitUntil(p) },
      { agentHostId, tenantId: Number(agentHost.tenantId), ...parsed.report },
    );
    // Only the host the run was dispatched to may report its steers.
    if (outcome.kind === 'not_found') return c.json({ error: 'Execution not found' }, 404);
    return c.json({ ok: true, outcome });
  });
}
