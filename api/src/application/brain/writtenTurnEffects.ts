/**
 * What a chat POST sets in motion for the turns it WROTE NOW - split out of `brainRoutes.ts` so the route stays a thin HTTP mapping.
 *
 * Everything here acts on `written` only: a deduplicated keyed POST (a retry of a message that already committed) answers its original
 * rows and fires none of it - no second ticket comment, ping, reply or learning pass. In order: the human's words become a comment on each
 * linked ticket; a HUMAN addressed in them is pinged; an AGENT addressed in them is dispatched to reply; and the persisted turns train the
 * project's Evermind. The fan-out (pings + replies) is spent against the tenant's dispatch budget - over it, the turn stays saved, the
 * fan-out is skipped and the caller says so.
 */
import { and, eq } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { chatTicketLinks } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { recordActivity, type ActorIdentity } from '../activity/activityLog';
import { notify } from '../notifications/notify';
import { consumeDispatchBudget } from '../ratelimit/tenantBuckets';
import type { BrainService } from './BrainService';
import { learnFromPersistedTurns, NOTHING_LEARNED, type BrainLearnOutcome } from './brainEvermindLearning';

const SOURCE = 'application/brain/writtenTurnEffects.ts';

/** What the effects need beyond the rows: who posted, in which chat, and the request's background runner (lazy: a dedup'd retry never touches it). */
export interface WrittenTurnContext {
  env: Env;
  db: Db;
  brainService: BrainService;
  chatId: number;
  tenantId: number;
  userId: string;
  /** The poster's tenant role and bearer token: an addressed agent never exceeds the human's reach. */
  role?: string;
  authToken: string | null;
  /** The request's background runner (`executionCtx.waitUntil`). */
  waitUntil: (work: Promise<unknown>) => void;
  /** The request's execution context, for the addressed agent's reply. */
  executionCtx: () => ExecutionContext;
  /** The acting human, resolved on demand (only when a linked ticket needs the comment). */
  resolveActor: () => Promise<ActorIdentity>;
}

/** The rows a POST wrote now (`written`, the request shape) and the stored rows of the same turns (`writtenRows`, what Evermind learns from). */
type Appended = Exclude<Awaited<ReturnType<BrainService['appendMessages']>>, { error: string }>;

/** Run every side effect of the turns just written; the learn outcome and whether the fan-out was throttled go back in the response. */
export async function runWrittenTurnEffects(
  ctx: WrittenTurnContext,
  appended: Pick<Appended, 'written' | 'writtenRows'>,
): Promise<{ evermindLearn: BrainLearnOutcome; dispatchThrottled: { retryAfterSeconds: number } | null }> {
  const { env, db, chatId, tenantId } = ctx;
  const { written } = appended;

  // A human posting into a chat that's linked to a ticket IS a comment on that ticket - surface it on the unified
  // activity/audit log (verb `comment.added`), fanned to each linked ticket. Off the response path; best-effort.
  const userText = written.filter((m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim());
  if (userText.length > 0) {
    ctx.waitUntil((async () => {
      let links: Array<{ kind: string; ref: string }> = [];
      try {
        links = await db.select({ kind: chatTicketLinks.ticketKind, ref: chatTicketLinks.ticketRef })
          .from(chatTicketLinks)
          .where(and(eq(chatTicketLinks.chatId, chatId), eq(chatTicketLinks.tenantId, tenantId)));
      } catch (error) {
        reportCaughtError(error, { source: SOURCE, operation: 'linkedTicketLookup' });
      }
      if (!links.length) return;
      const actor = await ctx.resolveActor();
      const summary = userText[userText.length - 1]!.content.replace(/\s+/g, ' ').trim().slice(0, 200);
      for (const l of links) {
        await recordActivity(env, db, {
          tenantId, actor, verb: 'comment.added',
          targetType: l.kind, targetId: l.ref, summary, metadata: { chatId },
        }).catch((error) => {
          reportCaughtError(error, { source: SOURCE, operation: 'recordTicketComment' });
        });
      }
    })());
  }

  // Notify any HUMAN addressed in these turns (directed @human message, or a member of a group turn) so an offline teammate
  // learns they were pinged - in-app + optional email. `addressedTo` is one participant or `{kind:'group', members}`
  // (brain-embedded `directedMessage.ts`). Directed @agent turns are ALSO dispatched here: the client used to skip group
  // fan-out and silently skip a missing persistence hook, so the Worker is the source of truth. Duplicate POSTs to
  // /agent-reply no-op via alreadyRepliedAsAgent.
  const mentioned = new Set<string>();
  const directedAgents: { agentRef: string; agentName: string }[] = [];
  const seenAgents = new Set<string>();
  for (const m of written) {
    if (m.role && m.role !== 'user') continue;
    if (!m.metadata) continue;
    try {
      type Addressee = { kind?: string; ref?: unknown; name?: unknown; members?: Addressee[]; refs?: unknown };
      const a = (JSON.parse(m.metadata) as { addressedTo?: Addressee }).addressedTo;
      const addressees: Addressee[] = a?.kind === 'group'
        ? (Array.isArray(a.members)
          ? a.members
          : Array.isArray(a.refs)
            ? (a.refs as unknown[]).filter((r): r is string => typeof r === 'string').map((ref) => ({ kind: 'agent', ref, name: ref }))
            : [])
        : a ? [a] : [];
      for (const r of addressees) {
        if (!r) continue;
        if (r.kind === 'human' && typeof r.ref === 'string' && r.ref) mentioned.add(r.ref);
        else if (r.kind !== 'human' && r.ref != null && r.ref !== '') {
          const agentRef = String(r.ref);
          if (seenAgents.has(agentRef)) continue;
          seenAgents.add(agentRef);
          directedAgents.push({
            agentRef,
            agentName: typeof r.name === 'string' && r.name ? r.name : agentRef,
          });
        }
      }
    } catch (error) { /* not directed */
      reportCaughtError(error, { source: SOURCE, operation: 'parseAddressedTo' });
    }
  }

  // The persist is exempt from the door limiter; the fan-out is not. One unit per directed agent (an LLM call) and per
  // mentioned human (in-app + email) is spent against `${tenantId}:dispatch`. Over budget: the turn stays saved, the fan-out
  // is skipped, and the response says so (never silently dropped).
  const dispatchUnits = directedAgents.length + mentioned.size;
  let dispatchThrottled: { retryAfterSeconds: number } | null = null;
  if (dispatchUnits > 0) {
    const verdict = await consumeDispatchBudget(env, tenantId, dispatchUnits).catch((error: unknown) => {
      // Limiter/plan lookup down - fail open like every bucket, but report it.
      reportCaughtError(error, { source: SOURCE, operation: 'consumeDispatchBudget' });
      return null;
    });
    if (verdict && !verdict.allowed) {
      dispatchThrottled = { retryAfterSeconds: verdict.retryAfterSeconds };
      reportCaughtError(new Error(`chat dispatch throttled: ${dispatchUnits} units over the tenant dispatch window`), { source: SOURCE, operation: 'consumeDispatchBudget' });
      mentioned.clear();
      directedAgents.length = 0;
    }
  }
  if (mentioned.size > 0) {
    ctx.waitUntil((async () => {
      for (const uid of mentioned) {
        try {
          await notify(db, env, {
            userId: uid, tenantId, kind: 'chat_mention',
            title: 'You were mentioned in a chat',
            body: 'A teammate addressed you in a Builderforce chat.',
            ref: String(chatId),
          });
        } catch (error) { /* best-effort */
          reportCaughtError(error, { source: SOURCE, operation: 'notifyMention' });
        }
      }
    })());
  }
  for (const agent of directedAgents) {
    ctx.waitUntil(
      ctx.brainService.agentReply(chatId, tenantId, ctx.userId, agent, env, {
        role: ctx.role,
        authToken: ctx.authToken,
        executionCtx: ctx.executionCtx(),
      }).then((reply) => {
        if (reply && typeof reply === 'object' && 'error' in reply && reply.error) {
          reportCaughtError(new Error(String(reply.error)), { source: SOURCE, operation: 'dispatchDirectedAgentReply' });
        }
      }).catch((error: unknown) => {
        reportCaughtError(error, { source: SOURCE, operation: 'dispatchDirectedAgentReply' });
      }),
    );
  }

  // Train the project's Evermind FROM this conversation (not just agent runs): a persisted assistant turn in a project chat whose
  // Evermind is seeded + connected is contributed to learning. ONE learn-on-persist entry point (shared with the `@agent` reply
  // path) evaluates the gate synchronously (a cached head read) so the response reports the TRUTHFUL outcome - the client renders
  // its `learn` step off this - and dispatches the slow coordinator contribution in the background.
  const evermindLearn = written.length === 0
    ? NOTHING_LEARNED
    : await learnFromPersistedTurns(env, db, chatId, tenantId, appended.writtenRows, ctx.waitUntil);
  return { evermindLearn, dispatchThrottled };
}
