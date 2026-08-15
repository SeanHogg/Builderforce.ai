import { reportCaughtError } from '../observability/caughtErrorReporter';
import { eq, and, or, desc, isNull, inArray, sql } from 'drizzle-orm';
import {
  brainChats,
  brainChatMessages,
  brainChatTrace,
  chatMemories,
  chatMembers,
  chatSessions,
  chatMessages,
  projectMemories,
  projects,
  teams,
  agentAssignments,
  users,
  tenantMembers,
} from '../../infrastructure/database/schema';
import { ideProxy, explicitModelPreemptsByo, readProxyChoice, codingModelsForPlan, byoAutoSeedModels, type LlmProxyService } from '../llm/LlmProxyService';
import { compactMessages, buildGatewaySummarizer, CLOUD_COMPACT_DEFAULTS } from '../llm/compactMessages';
import { classifyReplyAccount, buildReplyProvenance, vendorAccountLabel } from '../llm/replyProvenance';
import { recordActivity, cloudAgentActor, buildModelActivityMetadata } from '../activity/activityLog';
import { invite } from '../kernel/InvitationService';
import { getProjectEvermindHead, recordEvermindServeOutcome } from '../llm/projectEvermind';
import { isServableText } from '../llm/textCoherence';
import { learnFromPersistedTurns } from './brainEvermindLearning';
import { tenantProxyForPlan } from '../llm/tenantProxy';
import { vendorForModel } from '../llm/vendors';
import { recordProxyUsage } from '../llm/usageLedger';
import { recordActionRating } from '../llm/actionRatings';
import { resolveTenantPlan } from '../../presentation/routes/llmRoutes';
import { resolveWorkforceModel, WORKFORCE_MODEL_REF_PREFIX } from '../agent/agentPrompt';
import { listBuiltinTools, callBuiltinTool, CLOUD_AGENT_PLATFORM_TOOLS, CHAT_SCOPED_AGENT_TOOLS } from '../llm/builtinMcpService';
import { shouldRecoverStalledTurn, isExhaustedStall, isEmptyTurn, stallRecoveryNudge, stallExhaustedNotice, modelFailoverNotice, chooseStallFailover, MAX_ANNOUNCEMENT_RECOVERIES, MAX_MODEL_FAILOVERS, type ModelFallbackSurface } from '@builderforce/agent-stall';
import {
  BRAIN_ORIGIN, TEAM_ORIGIN, MANAGER_ORIGIN, ACCESSIBLE_ORIGINS,
  resolveChatAccess, syncPendingMemberships as syncPendingMembershipsShared,
} from './chatAccess';
import { markChatRead } from './chatReadState';
import { normalizeChatMode, resolveChatMode, NEW_CHAT_MODE } from './chatMode';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * A conversational-only tool: when the agent needs the USER to make a decision to
 * proceed, it calls `ask_user` with labelled options instead of asking in prose.
 * The reply's shared <QuestionCard> (brain-ui) renders the options as clickable
 * buttons and the user's choice comes back as their next message. A schema-validated
 * tool call is far more reliable than asking a weak model to hand-format the JSON in
 * prose — the exact failure the operator hit (questions rendered as unactionable text).
 *
 * NOT a platform action (autonomous cloud agents have no live user), so it is injected
 * only here in the Brain reply loop and intercepted as a TERMINAL turn — the loop stops
 * and the reply carries the canonical ```ask-user block {@link askUserBlock} builds.
 */
const ASK_USER_TOOL = 'ask_user';
const ASK_USER_TOOL_SPEC = {
  type: 'function',
  function: {
    name: ASK_USER_TOOL,
    description:
      'Ask the user to choose between options when you genuinely cannot proceed without their decision (e.g. who owns this, which approach, create under X or Y). Prefer this over asking in prose — the UI renders your options as clickable buttons and the choice returns as the user\'s next message. Do NOT use it for questions you can answer yourself from the code or context.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The single, specific question to ask.' },
        options: {
          type: 'array',
          description: '2–6 distinct, mutually-exclusive choices (unless multiSelect).',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Short choice text (1–5 words).' },
              description: { type: 'string', description: 'Optional one-line explanation of this choice.' },
            },
            required: ['label'],
          },
        },
        multiSelect: { type: 'boolean', description: 'Allow choosing more than one option. Default false.' },
      },
      required: ['question', 'options'],
    },
  },
} as const;

/** Build the canonical fenced block the shared brain-ui `parseAskUser` reads. Kept in
 *  sync with `serializeAskUser` in @seanhogg/builderforce-brain-ui (no UI dep here). */
function askUserBlock(args: unknown): string | null {
  const o = (args ?? {}) as Record<string, unknown>;
  const question = typeof o.question === 'string' ? o.question.trim() : '';
  const optionsIn = Array.isArray(o.options) ? o.options : [];
  const options = optionsIn
    .map((it) => {
      if (typeof it === 'string') return it.trim() ? { label: it.trim() } : null;
      if (it && typeof it === 'object') {
        const rec = it as Record<string, unknown>;
        const label = typeof rec.label === 'string' ? rec.label.trim() : '';
        const description = typeof rec.description === 'string' ? rec.description.trim() : undefined;
        return label ? { label, ...(description ? { description } : {}) } : null;
      }
      return null;
    })
    .filter((x): x is { label: string; description?: string } => !!x);
  // Needs a prompt + at least two choices to be a meaningful card; else let the caller
  // fall back to normal prose so the question is never swallowed.
  if (!question || options.length < 2) return null;
  const payload = { question, options, multiSelect: o.multiSelect === true };
  return ['```ask-user', JSON.stringify(payload), '```'].join('\n');
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateChatDto {
  tenantId: number;
  userId: string;
  title?: string;
  projectId?: number | null;
  capability?: string | null;
  /** Conversation (`chat`) or execution (`work`) — migration 0409. Omitted/invalid
   *  opens in {@link NEW_CHAT_MODE}. */
  mode?: string | null;
}

export interface UpdateChatDto {
  title?: string;
  projectId?: number | null;
  /** LOCK toggle (owner only): 'shared' = teammate-visible, 'locked' = private. */
  visibility?: 'shared' | 'locked';
  /** What the chat is making (migration 0345) — a client-registry capability id,
   *  or null to clear it. See {@link normalizeCapability}. */
  capability?: string | null;
  /** Switch the conversation between `chat` and `work` (migration 0409). An
   *  unrecognised value is IGNORED (the column is left as-is) rather than silently
   *  resetting a running execution back to a conversation. */
  mode?: string | null;
}

/**
 * Sanitize an inbound capability id. The catalogue itself is a client-side UI
 * registry (frontend/src/lib/brain/capabilities.ts) and an id the client no longer
 * knows resolves to "no capability" on read, so the server stores it opaquely
 * rather than keeping a second copy of the list that would drift. All we enforce is
 * the column's shape: a short, plain identifier, or null.
 */
function normalizeCapability(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return /^[a-z0-9_-]{1,64}$/i.test(s) ? s : null;
}

/**
 * The manager-tool ids {@link accountabilityFraming} instructs the agent to call.
 *
 * Exported so a test can assert that every one of them is actually ADVERTISED to the
 * model. That assertion is the regression guard for the defect this list documents: the
 * framing named tools by catalog id, the ids matched nothing in the model's tool list,
 * and the manager answered three consecutive accountability questions by describing the
 * calls it had never made. Nothing failed loudly — there is no error for "the prompt
 * referenced a tool that does not exist", which is exactly why it needs a test.
 */
export const ACCOUNTABILITY_TOOL_IDS: readonly string[] = [
  'manager.digest', 'manager.decisions', 'manager.census', 'manager.policy',
  'autonomy.wiring_audit', 'tickets.lifecycle',
];

/**
 * The standard the AI Manager is held to in its own accountability chat (0376).
 *
 * A person opens this chat to ask one thing — "what did you and the team get done, and
 * why not more?" — and the failure mode of an agent facing that question is well known:
 * it apologises, promises to do better, and says nothing checkable. Three instructions
 * are what turn that into an answer.
 *
 *   1. READ THE RECORD FIRST. The tools exist and are on the allowlist; an agent that
 *      does not call them is guessing about its own work.
 *   2. NAME THE GATE. The true cause of a dead board is almost never "I didn't try" —
 *      it is a withheld merge authority, an unstaffed lane, an exhausted token budget,
 *      a sign-off nobody gave. Those live in `manager.policy` and the census, and every
 *      one of them is actionable by the person asking.
 *   3. NEVER DRESS A ZERO AS PROGRESS. The digest reports yesterday alongside today
 *      precisely so a quiet day and a stopped board are distinguishable; a manager that
 *      blurs them has destroyed the only signal the page exists to carry.
 *
 * `projectId` is interpolated because every manager tool takes it and the model has no
 * other way to learn it.
 *
 * ── TOOLS ARE NAMED BY THEIR ADVERTISED NAME, NEVER THEIR CATALOG ID ─────────────
 * This is not a style point; it is the bug this function shipped with. The catalog id is
 * `manager.digest`, but a model is advertised `builtin_manager_digest` — so a prompt
 * naming the dotted id points at a tool that appears nowhere in the model's tool list.
 * The observed result was exactly what you would expect and nothing like an error: the
 * manager DESCRIBED the calls it could not make ("The tools required are manager.digest,
 * manager.decisions and manager.census") and reported having no data, three questions in
 * a row. `nameFor` resolves each id against the tools ACTUALLY advertised on this turn
 * and omits any that are missing — so the prompt cannot reference a tool the model does
 * not have, whatever changes to the allowlist come later.
 */
export function accountabilityFraming(projectId: number, nameFor: (toolId: string) => string | null): string {
  const digest = nameFor('manager.digest');
  const decisions = nameFor('manager.decisions');
  const census = nameFor('manager.census');
  const policy = nameFor('manager.policy');
  const wiring = nameFor('autonomy.wiring_audit');
  const lifecycle = nameFor('tickets.lifecycle');
  const call = (name: string | null, what: string) => (name ? `${name}(projectId=${projectId}) ${what}` : null);
  const record = [
    call(digest, 'for what finished today and yesterday'),
    call(decisions, 'for what you actually decided'),
    call(census, 'for what is stuck across every ticket'),
    call(policy, 'for what you were PERMITTED to do and whether autonomy was paused'),
  ].filter(Boolean).join(', ');

  return [
    `This is the AI MANAGER's accountability chat for project #${projectId}: the user is asking you to account for what the team — and you — actually got done, and why more did not. `,
    record
      ? `Before answering ANY question about outcomes you MUST actually CALL these tools — do not describe them, do not list them, do not say what they would return: ${record}. `
      : '',
    wiring ? `Call ${wiring}() when the question is whether work can complete unattended at all. ` : '',
    lifecycle ? `Call ${lifecycle}(taskId) for why one specific ticket is stuck. ` : '',
    `Answer with those numbers and cite the tickets by key. Never claim work you cannot point at, and never report that a tool "has not returned results" — if you have not called it, call it now. `,
    `If little or nothing got done, say so plainly in the first sentence, then name the SPECIFIC gate that held the work (an unstaffed lane, merge authority withheld from you, an exhausted token budget, a sign-off nobody gave, a failure breaker) and the ONE change that would unblock it. Do not apologise instead of explaining, and never describe a stalled board as progress. `,
  ].join('');
}

export interface AppendMessagesDto {
  messages: Array<{ role: string; content: string; metadata?: string }>;
}

/** Which team chat to resolve. A project team chat (`projectId`), a named workforce
 *  team's chat (`teamId`), or — both omitted — the tenant-wide "broader team" chat. */
export interface TeamChatScope {
  projectId?: number | null;
  teamId?: number | null;
}

// ---------------------------------------------------------------------------
// Return shapes (presentation-agnostic) — unified project chats, origin=brainstorm
// ---------------------------------------------------------------------------

const chatColumns = {
  id: brainChats.id,
  projectId: brainChats.projectId,
  origin: brainChats.origin,
  title: brainChats.title,
  ownerId: brainChats.userId,
  visibility: brainChats.visibility,
  capability: brainChats.capability,
  mode: brainChats.mode,
  createdAt: brainChats.createdAt,
  updatedAt: brainChats.updatedAt,
} as const;

const chatDetailColumns = {
  ...chatColumns,
  isArchived: brainChats.isArchived,
} as const;

const messageColumns = {
  id: brainChatMessages.id,
  role: brainChatMessages.role,
  content: brainChatMessages.content,
  metadata: brainChatMessages.metadata,
  seq: brainChatMessages.seq,
  createdAt: brainChatMessages.createdAt,
} as const;

const traceColumns = {
  id: brainChatTrace.id,
  turnSeq: brainChatTrace.turnSeq,
  kind: brainChatTrace.kind,
  label: brainChatTrace.label,
  argsJson: brainChatTrace.argsJson,
  resultJson: brainChatTrace.resultJson,
  isError: brainChatTrace.isError,
  durationMs: brainChatTrace.durationMs,
  ttftMs: brainChatTrace.ttftMs,
  createdAt: brainChatTrace.createdAt,
} as const;

/** Per-blob cap for a persisted trace arg/result (chars) — a runaway tool result
 *  can't bloat a row; the model already gets the full result live. */
const TRACE_JSON_MAX_CHARS = 20_000;

/** One persisted Brain trace event (tool/LLM-turn timeline). Shape mirrors the
 *  webview's BrainTraceEvent, minus the fields we derive on insert. */
export interface BrainTraceEventInput {
  kind: string;
  label?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  ttftMs?: number;
  turnSeq?: number;
}

type MessageFeedback = 'up' | 'down' | null;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Application service: orchestrates Brain chat use-cases.
 *
 * Encapsulates ownership checks, CRUD, LLM summarisation and project-memory
 * consolidation. The presentation layer delegates here and only maps HTTP ↔ DTO.
 */
export class BrainService {
  constructor(private readonly db: Db) {}

  // -----------------------------------------------------------------------
  // Ownership guard (DRY — used by every chat-scoped operation)
  // -----------------------------------------------------------------------

  private async verifyChatOwnership(
    chatId: number,
    tenantId: number,
    userId: string,
    selectExtra?: Record<string, unknown>,
  ) {
    const columns = { id: brainChats.id, ...(selectExtra ?? {}) };
    const [chat] = await this.db
      .select(columns as typeof columns & { id: typeof brainChats.id })
      .from(brainChats)
      .where(
        and(
          eq(brainChats.id, chatId),
          eq(brainChats.tenantId, tenantId),
          eq(brainChats.userId, userId),
          eq(brainChats.origin, BRAIN_ORIGIN),
        ),
      )
      .limit(1);
    return chat ?? null;
  }

  /**
   * Shared-access guard (migration 0288). Brain chats are global to their
   * project+tenant, so access depends on the chat's VISIBILITY:
   *   • 'shared' (default) → any teammate in the tenant may open/read/post; the
   *     first time a non-owner contributes they are auto-recorded as a member so
   *     the roster reflects the chat's live audience.
   *   • 'locked'           → only the OWNER or an active member may access.
   * Before denying a locked chat it lazily converts any pending email-invite for
   * this user, so a freshly-invited person can deep-link straight in.
   *
   * Owner-only admin (rename/archive/invite/remove/lock) keeps using
   * {@link verifyChatOwnership}.
   */
  private async canAccessChat(
    chatId: number,
    tenantId: number,
    userId: string,
    selectExtra?: Record<string, unknown>,
  ) {
    // Single shared-access guard — the SAME one ChatTicketService uses, so a chat
    // that reads here also resolves for its tickets/agents/members ({@link resolveChatAccess}).
    return resolveChatAccess(this.db, { chatId, tenantId, userId, selectExtra });
  }

  /** Record a contributing non-owner as an active member (the chat's audience),
   *  idempotent. Owners are skipped. Best-effort — a race just no-ops on the
   *  unique (chat_id, user_id) index. */
  private async ensureMembership(chatId: number, tenantId: number, userId: string, ownerId: string | null): Promise<void> {
    if (!userId || userId === ownerId) return;
    try {
      const [existing] = await this.db
        .select({ id: chatMembers.id })
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
        .limit(1);
      if (existing) return;
      await this.db.insert(chatMembers)
        .values({ chatId, tenantId, userId, status: 'active', role: 'participant' });
    } catch (error) {
      /* audience tracking is non-critical — never fail a post over it */
    
      reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "ensureMembership" });
    }
  }

  /** Activate any pending chat-member invites for this user (shared helper). */
  private syncPendingMemberships(tenantId: number, userId: string): Promise<number[]> {
    return syncPendingMembershipsShared(this.db, tenantId, userId);
  }

  private async verifyProjectInTenant(projectId: number, tenantId: number) {
    const [proj] = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
      .limit(1);
    return proj ?? null;
  }

  // -----------------------------------------------------------------------
  // LLM helper (DRY)
  // -----------------------------------------------------------------------

  // Caller passes the OpenRouter key; `ideProxy` handles pool + productName.
  // Cross-vendor fallbacks (Cerebras / Ollama) are not enabled here because
  // the BrainService doesn't carry the full env — internal summarization stays
  // single-vendor on purpose.
  private buildLlmService(apiKey: string) {
    return ideProxy({ OPENROUTER_API_KEY: apiKey });
  }

  /**
   * Build the LLM proxy for an INTERNAL Brain background call (chat summarize,
   * project-memory consolidate, agentHost-session summarize). When the tenant has
   * connected their OWN account (Claude subscription/OAuth or a provider api-key)
   * that account serves the call — BYO-funded, so it's $0 to the operator and runs
   * on the model the tenant chose — via the shared {@link tenantProxyForPlan} builder
   * (BYO-first, with plan-pool failover if the connected account errors). With NOTHING
   * connected it stays on the operator OpenRouter key exactly as before, so these
   * background summarizations never start spending the owner's frontier quota for
   * tenants who haven't opted in. This is the "$0-token summarization/consolidation for
   * tenants who connected their own account" path.
   */
  private async buildTenantLlmService(env: Env, tenantId: number): Promise<LlmProxyService> {
    const { proxy, hasByo } = await tenantProxyForPlan(env, tenantId).catch(
      () => ({ proxy: null as LlmProxyService | null, hasByo: false }),
    );
    // Any rankable account of the tenant's own — a connected provider OR a registered
    // OpenRouter connection — serves the call on their own model; otherwise keep the
    // unchanged operator-key path. `hasByo` covers both (a connection contributes no
    // BYO vendor id, so a vendor-set check alone would miss a connection-only tenant).
    if (proxy && hasByo) return proxy;
    return this.buildLlmService(env.OPENROUTER_API_KEY ?? '');
  }

  /** Record a Brain summarization call in the usage ledger [1310] (best-effort,
   *  fire-and-forget; no-ops without usage). These non-streaming background calls
   *  were previously invisible to billing. The apiKey-only env is enough for the
   *  usage row; pricing lookup is best-effort. */
  private recordUsage(apiKey: string | undefined, tenantId: number, useCase: string, result: Parameters<typeof recordProxyUsage>[2]['result']): void {
    void recordProxyUsage(this.db, { OPENROUTER_API_KEY: apiKey } as Env, { tenantId, useCase, result });
  }

  // -----------------------------------------------------------------------
  // Chat CRUD
  // -----------------------------------------------------------------------

  async listChats(
    tenantId: number,
    userId: string,
    opts?: { projectId?: string; limit?: number; offset?: number },
  ) {
    // Activate any pending email-invites for this user, then list chats they OWN
    // or are an active MEMBER of (shared access, migration 0288).
    await this.syncPendingMemberships(tenantId, userId);
    const memberRows = await this.db
      .select({ chatId: chatMembers.chatId })
      .from(chatMembers)
      .where(and(
        eq(chatMembers.tenantId, tenantId),
        eq(chatMembers.userId, userId),
        eq(chatMembers.status, 'active'),
      ));
    const memberChatIds = memberRows.map((r) => r.chatId);

    // Visible chats: ones you OWN, ones you're an active member of, and every
    // SHARED chat in this tenant (chats are global to project+tenant). Locked chats
    // only surface to their owner/members.
    const visible = memberChatIds.length > 0
      ? or(eq(brainChats.userId, userId), eq(brainChats.visibility, 'shared'), inArray(brainChats.id, memberChatIds))!
      : or(eq(brainChats.userId, userId), eq(brainChats.visibility, 'shared'))!;
    const conditions = [
      eq(brainChats.tenantId, tenantId),
      visible,
      eq(brainChats.origin, BRAIN_ORIGIN),
      eq(brainChats.isArchived, false),
    ];

    if (opts?.projectId === 'none') {
      conditions.push(isNull(brainChats.projectId));
    } else if (opts?.projectId) {
      const pid = Number(opts.projectId);
      if (!Number.isNaN(pid)) conditions.push(eq(brainChats.projectId, pid));
    }

    const limit = Math.min(opts?.limit ?? 50, 200);
    const offset = opts?.offset ?? 0;

    const rows = await this.db
      .select(chatColumns)
      .from(brainChats)
      .where(and(...conditions))
      .orderBy(desc(brainChats.updatedAt))
      .limit(limit)
      .offset(offset);

    // Attach each chat's invited participants (multi-party chat) so a surface can
    // show a participant roster / avatars on the row. ONE extra grouped query over
    // the just-returned chat ids (no N+1), scoped to this user's chats. Additive
    // and guarded: participants are a nice-to-have, so a failure here must never
    // break the chat list itself.
    return this.attachParticipants(tenantId, rows);
  }

  /** Fold `participants: {ref, kind, name?}[]` onto chat rows via one grouped query. */
  private async attachParticipants<T extends { id: number }>(
    tenantId: number,
    rows: T[],
  ): Promise<Array<T & { participants: Array<{ ref: string; kind: string; name?: string }> }>> {
    const byChat = new Map<number, Array<{ ref: string; kind: string; name?: string }>>();
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      try {
        const asg = await this.db
          .select({
            scopeId: agentAssignments.scopeId,
            agentRef: agentAssignments.agentRef,
            agentKind: agentAssignments.agentKind,
          })
          .from(agentAssignments)
          .where(and(
            eq(agentAssignments.tenantId, tenantId),
            eq(agentAssignments.scope, 'chat'),
            inArray(agentAssignments.scopeId, ids.map(String)),
          ));
        for (const a of asg) {
          const cid = Number(a.scopeId);
          if (!Number.isNaN(cid)) {
            const list = byChat.get(cid) ?? [];
            list.push({ ref: a.agentRef, kind: 'agent' });
            byChat.set(cid, list);
          }
        }
        // Human members (migration 0288) join the same roster with kind='human',
        // ref = their user id, name = their display name (so a non-webview surface
        // like the native SESSIONS tree can label them without a second lookup).
        const mem = await this.db
          .select({ chatId: chatMembers.chatId, userId: chatMembers.userId, name: users.displayName, email: users.email })
          .from(chatMembers)
          .leftJoin(users, eq(users.id, chatMembers.userId))
          .where(and(
            eq(chatMembers.tenantId, tenantId),
            eq(chatMembers.status, 'active'),
            inArray(chatMembers.chatId, ids),
          ));
        for (const m of mem) {
          if (!m.userId) continue;
          const list = byChat.get(m.chatId) ?? [];
          list.push({ ref: m.userId, kind: 'human', name: m.name || m.email || undefined });
          byChat.set(m.chatId, list);
        }
      } catch (error) {
        /* participants are non-critical — the chat list must survive their absence */
      
        reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "attachParticipants" });
      }
    }
    return rows.map((r) => ({ ...r, participants: byChat.get(r.id) ?? [] }));
  }

  async createChat(dto: CreateChatDto) {
    const title = dto.title?.trim() || 'New chat';

    if (dto.projectId != null) {
      const proj = await this.verifyProjectInTenant(dto.projectId, dto.tenantId);
      if (!proj) return { error: 'Project not found in tenant' as const };
    }

    const [chat] = await this.db
      .insert(brainChats)
      .values({
        tenantId: dto.tenantId,
        userId: dto.userId,
        origin: BRAIN_ORIGIN,
        projectId: dto.projectId ?? null,
        title,
        capability: normalizeCapability(dto.capability),
        mode: normalizeChatMode(dto.mode) ?? NEW_CHAT_MODE,
      })
      .returning(chatColumns);

    return chat;
  }

  // -----------------------------------------------------------------------
  // Team Chat — the canonical, always-there group chat (migration 0294)
  // -----------------------------------------------------------------------

  /** Resolve the ONE team chat for a scope, creating it on first access. Scope is
   *  a project (`projectId`), a named workforce team (`teamId`), or — when both are
   *  null — the tenant-wide "broader team". Race-safe: the unique `uq_team_chat_scope`
   *  index means a concurrent create just re-selects the winner. `userId` may be null
   *  (an unattended agent resolving it). */
  private async findTeamChat(tenantId: number, scope: TeamChatScope) {
    return this.findScopedChat(tenantId, TEAM_ORIGIN, scope);
  }

  /**
   * The live (non-archived) chat that IS a given scope, for any singleton-chat origin.
   *
   * Shared by the team chat (0294) and the manager chat (0376) because they are the
   * same shape — one canonical conversation per (tenant, origin, scope), backed by a
   * partial unique index and resolved by get-or-create. Duplicating the lookup is how
   * two "always-there" chats drift into disagreeing about what "already exists" means,
   * and a forked singleton chat loses half its transcript on the next read.
   */
  private async findScopedChat(tenantId: number, origin: string, scope: TeamChatScope) {
    const [row] = await this.db
      .select(chatDetailColumns)
      .from(brainChats)
      .where(and(
        eq(brainChats.tenantId, tenantId),
        eq(brainChats.origin, origin),
        eq(brainChats.isArchived, false),
        scope.projectId != null ? eq(brainChats.projectId, scope.projectId) : isNull(brainChats.projectId),
        scope.teamId != null ? eq(brainChats.teamId, scope.teamId) : isNull(brainChats.teamId),
      ))
      .limit(1);
    return row ?? null;
  }

  /**
   * Resolve the ONE MANAGER chat for a project, creating it on first access (0376).
   *
   * This is where a person holds the AI Manager to account — "what did you and the team
   * get done today, and why not more?" — so it is deliberately a real Brain chat rather
   * than a bespoke Q&A log: it inherits the transcript, the members, the agent
   * participants, the addressed-agent reply loop and the tool trace, and the manager
   * answers through the SAME path any other agent teammate answers through.
   *
   * `visibility: 'shared'` because the manager's account of the team's day belongs to
   * the team, not to whoever opened the page first. Race-safe via `uq_manager_chat_scope`.
   */
  async getOrCreateManagerChat(tenantId: number, userId: string | null, projectId: number) {
    const proj = await this.verifyProjectInTenant(projectId, tenantId);
    if (!proj) return { error: 'Project not found in tenant' as const };

    let chat = await this.findScopedChat(tenantId, MANAGER_ORIGIN, { projectId });
    if (!chat) {
      try {
        const [created] = await this.db
          .insert(brainChats)
          .values({
            tenantId, userId: userId ?? null, origin: MANAGER_ORIGIN, projectId,
            title: `${proj.name} — Manager`, visibility: 'shared',
          })
          .returning(chatDetailColumns);
        chat = created ?? null;
      } catch {
        // Lost the create race (unique index) — the winner is now selectable.
        chat = await this.findScopedChat(tenantId, MANAGER_ORIGIN, { projectId });
      }
    }
    if (!chat) return { error: 'Chat not found' as const };

    const { ownerId, ...rest } = chat as unknown as Record<string, unknown> & { ownerId: string | null };
    return {
      ...rest,
      id: (chat as unknown as { id: number }).id,
      isOwner: ownerId != null && ownerId === userId,
      visibility: (rest as { visibility?: string }).visibility ?? 'shared',
      isManagerChat: true as const,
    };
  }

  private async verifyTeamInTenant(teamId: number, tenantId: number) {
    const [team] = await this.db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId)))
      .limit(1);
    return team ?? null;
  }

  async getOrCreateTeamChat(tenantId: number, userId: string | null, scope: TeamChatScope = {}) {
    const projectId = scope.projectId ?? null;
    const teamId = scope.teamId ?? null;
    let title = 'Team Chat';
    if (projectId != null) {
      const proj = await this.verifyProjectInTenant(projectId, tenantId);
      if (!proj) return { error: 'Project not found in tenant' as const };
      title = `${proj.name} — Team`;
    } else if (teamId != null) {
      const team = await this.verifyTeamInTenant(teamId, tenantId);
      if (!team) return { error: 'Team not found in tenant' as const };
      title = `${team.name}`;
    }

    let chat = await this.findTeamChat(tenantId, { projectId, teamId });
    if (!chat) {
      try {
        const [created] = await this.db
          .insert(brainChats)
          .values({ tenantId, userId: userId ?? null, origin: TEAM_ORIGIN, projectId, teamId, title, visibility: 'shared' })
          .returning(chatDetailColumns);
        chat = created ?? null;
      } catch {
        // Lost the create race (unique index) — the winner is now selectable.
        chat = await this.findTeamChat(tenantId, { projectId, teamId });
      }
    }
    if (!chat) return { error: 'Chat not found' as const };

    const { ownerId, ...rest } = chat as unknown as Record<string, unknown> & { ownerId: string | null };
    return {
      ...rest,
      id: (chat as unknown as { id: number }).id,
      isOwner: ownerId != null && ownerId === userId,
      visibility: (rest as { visibility?: string }).visibility ?? 'shared',
      isTeamChat: true as const,
    };
  }

  /** Read the recent transcript of a team chat (agent-facing — server picks the
   *  tenant's own canonical chat, so there is no cross-tenant id to guard). */
  async readTeamChat(tenantId: number, scope: TeamChatScope, limit = 30) {
    const resolved = await this.getOrCreateTeamChat(tenantId, null, scope);
    if ('error' in resolved) return resolved;
    const msgs = await this.db
      .select(messageColumns)
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, resolved.id as number))
      .orderBy(desc(brainChatMessages.seq))
      .limit(Math.min(Math.max(1, limit), 100));
    return { chatId: resolved.id, messages: msgs.reverse() };
  }

  /** Post a message INTO a team chat as an agent (agent-facing — no human userId
   *  gate; the server resolves the tenant's own canonical chat). Attribution rides
   *  metadata.authoredBy, mirroring {@link agentReply}. */
  async postToTeamChat(
    tenantId: number,
    scope: TeamChatScope,
    content: string,
    opts?: { fromName?: string; fromRef?: string },
  ) {
    const text = content?.trim();
    if (!text) return { error: 'content is required' as const };
    const resolved = await this.getOrCreateTeamChat(tenantId, null, scope);
    if ('error' in resolved) return resolved;
    const metadata = JSON.stringify({
      via: 'team_chat.post',
      authoredBy: { kind: 'agent', ref: opts?.fromRef ?? 'agent', ...(opts?.fromName ? { name: opts.fromName } : {}) },
    });
    const [msg] = await this.appendRaw(resolved.id as number, [{ role: 'assistant', content: text, metadata }]);
    return { chatId: resolved.id, message: msg ?? null };
  }

  async getChat(chatId: number, tenantId: number, userId: string) {
    // Owner, member, or (shared) any teammate may open the chat — migration 0288.
    const chat = await this.canAccessChat(chatId, tenantId, userId, {
      projectId: brainChats.projectId,
      origin: brainChats.origin,
      title: brainChats.title,
      capability: brainChats.capability,
      createdAt: brainChats.createdAt,
      updatedAt: brainChats.updatedAt,
      isArchived: brainChats.isArchived,
    });
    if (!chat) return null;
    // Surface ownership + lock state so the client can gate owner-only controls.
    const { ownerId, ...rest } = chat as unknown as Record<string, unknown> & { ownerId: string | null };
    return { ...rest, isOwner: ownerId === userId, visibility: (rest as { visibility?: string }).visibility ?? 'shared' };
  }

  async updateChat(
    chatId: number,
    tenantId: number,
    userId: string,
    dto: UpdateChatDto,
  ) {
    // `mode` is read alongside the ownership check so the caller can tell an actual
    // mode SWITCH from a PATCH that merely restated the current one — the audit row is
    // about the moment authority changed hands, and a no-op must not manufacture one.
    const existing = await this.verifyChatOwnership(chatId, tenantId, userId, {
      mode: brainChats.mode,
      origin: brainChats.origin,
    });
    if (!existing) return { error: 'Chat not found' as const };

    if (dto.projectId != null) {
      const proj = await this.verifyProjectInTenant(dto.projectId, tenantId);
      if (!proj) return { error: 'Project not found in tenant' as const };
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.title !== undefined) updates.title = dto.title.trim() || 'New chat';
    if (dto.projectId !== undefined) updates.projectId = dto.projectId;
    if (dto.visibility === 'shared' || dto.visibility === 'locked') updates.visibility = dto.visibility;
    if (dto.capability !== undefined) updates.capability = normalizeCapability(dto.capability);
    // An unrecognised mode is IGNORED rather than coerced: coercing would quietly
    // demote a running execution back to a conversation (and strip its dispatch
    // authority) because a stale client sent a value this build does not know.
    const nextMode = normalizeChatMode(dto.mode);
    if (nextMode) updates.mode = nextMode;

    const [updated] = await this.db
      .update(brainChats)
      .set(updates)
      .where(eq(brainChats.id, chatId))
      .returning(chatColumns);

    // `modeChangedTo` is transient provenance for the CALLER (the route writes the audit
    // row — it owns `env` and the waitUntil budget), never a persisted column. Null when
    // the mode was not touched or the PATCH restated the value it already had.
    const previousMode = resolveChatMode(existing as { origin?: string | null; mode?: string | null });
    const modeChangedTo = nextMode && nextMode !== previousMode ? nextMode : null;
    return { ...updated, modeChangedTo };
  }

  async archiveChat(chatId: number, tenantId: number, userId: string) {
    const existing = await this.verifyChatOwnership(chatId, tenantId, userId);
    if (!existing) return { error: 'Chat not found' as const };

    await this.db
      .update(brainChats)
      .set({ isArchived: true, updatedAt: new Date() })
      .where(eq(brainChats.id, chatId));

    return { ok: true };
  }

  // -----------------------------------------------------------------------
  // Messages
  // -----------------------------------------------------------------------

  async getMessages(chatId: number, tenantId: number, userId: string, limit = 100) {
    const chat = await this.canAccessChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };

    const msgs = await this.db
      .select(messageColumns)
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(brainChatMessages.seq)
      .limit(Math.min(limit, 500));

    return msgs;
  }

  /** Advance the caller's read high-water mark for a chat (unread-badge state).
   *  Access-checked, then delegates to the shared {@link markChatRead} rule.
   *  `seq` omitted → mark everything read. Returns the seq actually stored. */
  async markRead(chatId: number, tenantId: number, userId: string, seq?: number | null) {
    const chat = await this.canAccessChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    const lastReadSeq = await markChatRead(this.db, tenantId, userId, chatId, seq);
    return { lastReadSeq };
  }

  async appendMessages(
    chatId: number,
    tenantId: number,
    userId: string,
    dto: AppendMessagesDto,
  ) {
    // Owner, member, or (for shared chats) any teammate may post — migration 0288.
    const chat = await this.canAccessChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };

    if (!Array.isArray(dto.messages) || dto.messages.length === 0) {
      return { error: 'messages array is required' as const };
    }

    // Contributing to a shared chat joins you to it (records the live audience).
    await this.ensureMembership(chatId, tenantId, userId, (chat as unknown as { ownerId: string | null }).ownerId);

    return this.appendRaw(chatId, dto.messages);
  }

  /** Append messages to a chat (seq-managed insert + touch), NO access check —
   *  callers must have already verified access. Shared by {@link appendMessages}
   *  and {@link agentReply} so the write path lives once. */
  private async appendRaw(chatId: number, messages: Array<{ role: string; content: string; metadata?: string | null }>) {
    const valid = messages.filter((m) => m.role && typeof m.content === 'string');
    if (valid.length === 0) return [];

    // ONE insert for the whole batch, not one per message. This used to be two
    // round-trips per turn in a loop, which is invisible on a 2-message append and
    // becomes 400 queries when a shared guest room's transcript is claimed into an
    // account in a single call.
    const rows = await this.db
      .insert(brainChatMessages)
      .values(valid.map((msg) => ({
        chatId,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata ?? null,
      })))
      .returning(messageColumns);

    // The generated PK is an atomic database append order. A read-then-write
    // MAX(seq)+1 races when agents and humans append concurrently — so seq simply
    // BECOMES the id, in one statement for the batch.
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await this.db
        .update(brainChatMessages)
        .set({ seq: sql`${brainChatMessages.id}` })
        .where(inArray(brainChatMessages.id, ids));
    }

    // Touch updatedAt on the chat
    await this.db
      .update(brainChats)
      .set({ updatedAt: new Date() })
      .where(eq(brainChats.id, chatId));

    return rows.map((row) => ({ ...row, seq: row.id }));
  }

  /**
   * Post a progress/result update from a cloud execution into the Brain chat that
   * launched it. The execution payload supplies the chat id; callers may not choose
   * an unrelated chat. Tenant scope and archive state are still checked here at the
   * write boundary, and attribution remains machine-readable in message metadata.
   */
  async postExecutionUpdate(
    chatId: number,
    tenantId: number,
    input: { agentRef: string; agentName?: string; content: string },
  ) {
    const [chat] = await this.db
      .select({ id: brainChats.id })
      .from(brainChats)
      .where(and(
        eq(brainChats.id, chatId),
        eq(brainChats.tenantId, tenantId),
        eq(brainChats.isArchived, false),
      ))
      .limit(1);
    if (!chat) return { error: 'Originating Brain chat not found' as const };

    const content = input.content.trim();
    if (!content) return { error: 'content is required' as const };
    const agentName = input.agentName?.trim() || 'BuilderForce Agent';
    const metadata = JSON.stringify({
      authoredBy: { kind: 'agent', ref: input.agentRef, name: agentName },
      via: 'cloud-execution',
    });
    const [message] = await this.appendRaw(chatId, [{ role: 'assistant', content, metadata }]);
    return { chatId, message };
  }

  // -----------------------------------------------------------------------
  // Trace (persisted tool/LLM-turn timeline — survives a reload; migration 0330)
  // -----------------------------------------------------------------------

  /** Verify the caller may read/write this chat (shared-access guard, 0288).
   *  Public so the trace routes can gate before the cached read/append without
   *  the service having to re-plumb tenantId/userId through every trace call. */
  async canAccess(chatId: number, tenantId: number, userId: string): Promise<boolean> {
    return (await this.canAccessChat(chatId, tenantId, userId)) != null;
  }

  /** Bulk-append trace events to a chat (append-only, NO access check — the route
   *  gates first). Neon-http has no interactive transactions, so this is a single
   *  multi-row INSERT (one statement). Bounds each JSON blob so a runaway tool
   *  result can't bloat a row. Returns the number of rows written. */
  async appendTrace(chatId: number, events: BrainTraceEventInput[]): Promise<{ appended: number }> {
    if (!Array.isArray(events) || events.length === 0) return { appended: 0 };
    const clamp = (v: unknown): string | null => {
      if (v == null) return null;
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.length > TRACE_JSON_MAX_CHARS ? s.slice(0, TRACE_JSON_MAX_CHARS) : s;
    };
    const rows = events
      .filter((e) => e && typeof e.kind === 'string' && e.kind.length > 0)
      .map((e) => ({
        chatId,
        turnSeq: Number.isFinite(e.turnSeq as number) ? Number(e.turnSeq) : null,
        kind: String(e.kind).slice(0, 24),
        label: e.label != null ? String(e.label).slice(0, 120) : null,
        argsJson: clamp(e.args),
        resultJson: clamp(e.result),
        isError: e.isError === true,
        durationMs: Number.isFinite(e.durationMs as number) ? Number(e.durationMs) : null,
        ttftMs: Number.isFinite(e.ttftMs as number) ? Number(e.ttftMs) : null,
      }));
    if (rows.length === 0) return { appended: 0 };
    await this.db.insert(brainChatTrace).values(rows);
    return { appended: rows.length };
  }

  /** Read a chat's persisted trace timeline, oldest-first (insert order). NO access
   *  check — the route gates + wraps this in the read-through cache. */
  async getTrace(chatId: number, limit = 500) {
    return this.db
      .select(traceColumns)
      .from(brainChatTrace)
      .where(eq(brainChatTrace.chatId, chatId))
      .orderBy(brainChatTrace.id)
      .limit(Math.min(Math.max(1, limit), 2000));
  }

  // -----------------------------------------------------------------------
  // Addressed-agent reply — a chat-scoped run that answers AS an invited agent
  // -----------------------------------------------------------------------

  /**
   * Produce a reply AS an invited agent participant and post it as an assistant
   * turn attributed to that agent (metadata `authoredBy: {kind:'agent', ref, name}`,
   * mirroring the `addressedTo` convention). This is the "next layer" over directed
   * messages: `@agent`-ing a participant used to only post the user's turn; now the
   * addressed agent actually answers, grounded on its own persona + ingested
   * knowledge (via the shared {@link resolveWorkforceModel}) and on the transcript.
   *
   * The agent runs a BOUNDED server-side tool loop over the curated, non-destructive
   * platform tools (`CLOUD_AGENT_PLATFORM_TOOLS` — projects/tasks/specs/OKRs/knowledge
   * reads + safe writes, NO deletes or control-plane) PLUS the chat-scoped read/link
   * tools (`CHAT_SCOPED_AGENT_TOOLS` — list/link/unlink tickets on THIS chat, the current
   * chatId injected into the system prompt), executed via `callBuiltinTool`
   * with the TRIGGERING USER's role/token so the agent can never exceed the human's
   * own permissions. So a teammate agent can actually DO things (create a follow-up
   * task, update an OKR, read the board) when addressed — not just chat. Tool errors
   * are fed back as tool results so the agent can recover or explain. File-editing is
   * still the BRAIN/host loop's job; this is the platform-tool layer.
   */
  async agentReply(
    chatId: number,
    tenantId: number,
    userId: string,
    input: { agentRef: string; agentName?: string },
    env: Env,
    opts?: { role?: string; authToken?: string | null; executionCtx?: ExecutionContext },
  ) {
    // `origin` is read alongside the access check because the MANAGER chat (0376) asks a
    // different KIND of question than a team chat does — see `accountabilityFraming`.
    // `mode` (0409) decides whether this reply may turn its conclusions into dispatched
    // work or must stop at answering; both are resolved together by `resolveChatMode`.
    const chat = await this.canAccessChat(chatId, tenantId, userId, {
      projectId: brainChats.projectId,
      origin: brainChats.origin,
      mode: brainChats.mode,
    });
    if (!chat) return { error: 'Chat not found' as const };
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) return { error: 'LLM not configured' as const };

    const msgs = await this.db
      .select({ role: brainChatMessages.role, content: brainChatMessages.content, metadata: brainChatMessages.metadata })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(brainChatMessages.seq)
      .limit(80);
    if (msgs.length === 0) return { error: 'Nothing to reply to' as const };

    // Persona + own-knowledge grounding for a workforce agent (ref = ide_agents.id).
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? '';
    const resolved = await resolveWorkforceModel(env, tenantId, WORKFORCE_MODEL_REF_PREFIX + input.agentRef, lastUser).catch(() => null);
    const agentName = input.agentName?.trim() || 'the agent';
    const persona = resolved?.directives
      ? `${resolved.directives}\n\n`
      : `You are ${agentName}, a member of this team's chat.\n\n`;
    // The persona's compiled directives are already folded into `resolved.directives`
    // (→ the system prompt), and its compiled temperature drives sampling here — so the
    // agent replies UNDER its personality, tone AND sampling, instead of a flat default.
    // Falls back to the prior 0.4 when the agent carries no psychometric profile.
    const replyTemp = resolved?.execParams?.temperature ?? 0.4;

    const authorName = (label: string | null): string => {
      if (!label) return 'BuilderForce';
      try {
        const a = (JSON.parse(label) as { authoredBy?: { name?: string } }).authoredBy;
        return a?.name || 'BuilderForce';
      } catch { return 'BuilderForce'; }
    };
    const transcript = msgs
      .map((m) => `${m.role === 'user' ? 'User' : authorName(m.metadata)}: ${m.content}`)
      .join('\n\n');

    const projectHint = (chat as unknown as { projectId?: number | null }).projectId ?? null;
    const isManagerChat = (chat as unknown as { origin?: string | null }).origin === MANAGER_ORIGIN;
    // Conversation or execution (0409). Team + manager chats resolve to 'work' by origin
    // whatever the column says — driving work IS what those conversations are for.
    const chatMode = resolveChatMode(chat as { origin?: string | null; mode?: string | null });

    // Curated, non-destructive platform tools (the same allowlist an autonomous cloud
    // agent gets) PLUS the chat-scoped read/link tools that only make sense with a live
    // chatId (so an agent addressed in a chat can link work to it). Advertised name →
    // tool id map for executing the model's calls.
    //
    // Resolved BEFORE the system prompt because the prompt must name tools by the string
    // the model was actually given. It previously named them by catalog id (`manager.digest`,
    // `chats.link_ticket`) — names that appear nowhere in the model's tool list — and the
    // measured result was an agent narrating the calls it could not make instead of making
    // them. `nameFor` returns null for a tool that is not advertised on this turn, so a
    // prompt clause referencing it is DROPPED rather than pointing at nothing.
    const agentToolIds = [...CLOUD_AGENT_PLATFORM_TOOLS, ...CHAT_SCOPED_AGENT_TOOLS];
    const toolEntries = listBuiltinTools().filter((t) => agentToolIds.includes(t.tool));
    const nameToTool = new Map(toolEntries.map((t) => [t.name, t.tool]));
    const toolToName = new Map(toolEntries.map((t) => [t.tool, t.name]));
    const nameFor = (toolId: string): string | null => toolToName.get(toolId) ?? null;
    // Advertise the platform tools PLUS the conversational `ask_user` tool (injected
    // here, intercepted below as a terminal turn — see ASK_USER_TOOL_SPEC).
    const tools = [
      ...toolEntries.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })),
      ASK_USER_TOOL_SPEC,
    ];

    const linkTicket = nameFor('chats.link_ticket');
    const listTickets = nameFor('chats.list_tickets');
    const systemPrompt = [
      persona,
      `You have been addressed directly in this multi-party team chat${projectHint != null ? ` (project #${projectHint})` : ''}. `,
      // The MANAGER chat's framing (0376). It lives here rather than only in the built-in
      // Manager agent's persona because a tenant may designate its OWN cloud agent to run
      // the backlog, and that agent's persona knows nothing about being accountable for
      // it. The standard has to attach to the CONVERSATION, not to one agent row, or the
      // answer quality would silently depend on who was designated.
      ...(isManagerChat && projectHint != null ? [accountabilityFraming(projectHint, nameFor)] : []),
      `Reply AS ${agentName} — first person, concise, helpful, no preamble and no "${agentName}:" label. `,
      `You may use the provided tools to read or update the team's work (projects, tasks, specs, OKRs, knowledge) when it helps answer or act on the request. After using tools, summarise what you found or did. `,
      // The agent IS a participant in this chat (chatId is known here, not to the model) —
      // tell it the id so it can tie work items to THIS conversation. Named by ADVERTISED
      // name for the same reason as above; dropped entirely when the tools are not offered.
      `You are participating in Brain chat #${chatId}. `,
      // MODE (0409). In a CONVERSATION the agent answers and stops; in an EXECUTION it
      // ties what it concludes to the chat as real, tracked work. Without this an
      // addressed agent opened tickets off the back of a question, which is the same
      // defect the client-side loop had.
      chatMode === 'work'
        ? (linkTicket && listTickets
            ? `This conversation is in WORK mode: turn what you conclude into real work rather than describing it. Tie every work item you create or discuss to the chat with ${linkTicket}(chatId=${chatId}), and use ${listTickets}(chatId=${chatId}) to see what is already linked so you never duplicate one. `
            : '')
        : `This conversation is in CHAT mode: answer the question. Read and investigate freely, but do not create, re-status or dispatch board work as a side effect of answering — unless the user explicitly asks you to in this message. If something clearly ought to be tracked, say so in one line at the end and leave it to the user. `,
      `When you need the user to make a decision before you can proceed (an owner, an approach, one target vs another), call the ${ASK_USER_TOOL} tool with labelled options INSTEAD of asking in prose — do not end your reply with unanswered questions when ${ASK_USER_TOOL} would let the user just click a choice.`,
    ].join('');

    const convo: Array<Record<string, unknown>> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Conversation so far:\n\n${transcript}` },
    ];

    // ONE builder: the tenant's connected frontier account (BYO Claude subscription /
    // api-key) threaded + plan resolved together, so the addressed agent runs on the
    // tenant's OWN account when they have one — NOT a weak operator-key model that
    // empty-turns. `codingOnly` restricts failover to the curated coding pool + paid
    // coding backstop (agentic tool turn), never a lite non-coder.
    const { proxy: service, byoVendors, registeredModels, plan } = await tenantProxyForPlan(env, tenantId, { codingOnly: true });
    // The tenant's connected account beats a weak/default agent base model. Honor an
    // explicit base model ONLY when it preempts the BYO seed — the tenant has no
    // connected account, OR the base model is itself served by a connected BYO vendor.
    // Otherwise leave the model unset so complete() seeds the tenant's BYO flagship
    // (Opus for this agentic turn) instead of a free operator-keyed coder (e.g. a default
    // `@cf/*` model) that returns empty turns and never touches the connected account —
    // the exact bug where a connected Claude subscription still ran Ada on `@cf/qwen/...`.
    const baseModel = resolved?.baseModel ?? undefined;
    const pinnedModel = explicitModelPreemptsByo(baseModel, byoVendors, registeredModels) ? baseModel : undefined;
    const readModel = (r: unknown): string => (r as { resolvedModel?: string } | undefined)?.resolvedModel ?? '';
    // The vendor + whether the tenant's OWN account served the turn — captured per
    // completion so the FINAL turn's values drive both the empty-reply diagnostic and
    // the per-reply provenance chip persisted on a successful turn.
    const readVendor = (r: unknown): string => (r as { resolvedVendor?: string } | undefined)?.resolvedVendor ?? '';
    const readByoFunded = (r: unknown): boolean => (r as { byoFunded?: boolean } | undefined)?.byoFunded === true;
    let lastVendor = '';
    let lastByoFunded = false;
    const hasConnectedAccount = byoVendors.size > 0;

    // Track the connected-account attempt's failure so a silent cascade off the tenant's
    // OWN account is SURFACED (e.g. an expired subscription token 401s → the run falls to
    // a weak coder that empty-turns). The proxy records each failed attempt in
    // `failovers` with its vendor + upstream status; capture the one on a connected vendor.
    let byoFailure: { vendor: string; code: number; detail?: string } | null = null;
    const noteByoFailure = (r: unknown): void => {
      const failovers = (r as { failovers?: Array<{ vendor?: string; code?: number; detail?: string }> } | undefined)?.failovers;
      const f = failovers?.find((x) => x.vendor && byoVendors.has(x.vendor));
      if (f?.vendor) byoFailure = { vendor: f.vendor, code: f.code ?? 0, ...(f.detail ? { detail: f.detail } : {}) };
    };

    const MAX_ITERS = 6;
    let text = '';
    let toolCallCount = 0;
    let iterations = 0;
    /**
     * The reply's TOOL TRACE, persisted at the end of the turn.
     *
     * This loop used to leave no server-side record of what it did: the trace table was
     * written only by the client-driven Brain run loop, so an addressed-agent reply — the
     * ONLY path the manager's accountability chat uses — was unauditable. When the manager
     * answered "the required tools have not returned results" there was literally nothing
     * to inspect: no tool rows, no errors, no way to tell "the model never called anything"
     * from "every call failed". Those two have completely different fixes, and the surface
     * could not distinguish them.
     *
     * Buffered rather than written per tool because a Worker should not pay a round-trip
     * inside the loop; one bounded append at the end is enough for a diagnostic and cannot
     * slow the reply. Best-effort throughout — a trace failure must never cost an answer.
     */
    const trace: BrainTraceEventInput[] = [];
    // Budget for the announced-but-untaken tool call recovery below (shared with the
    // Brain run loop and the agent runtime via `@builderforce/agent-stall`).
    let announcementRecoveries = 0;
    // The model this reply is currently talking to, plus every model already tried.
    // A model that burns its whole stall budget without emitting a tool call is spent;
    // the only remedy left is a DIFFERENT model, so the reply picks one itself.
    let activeModel = pinnedModel;
    const triedModels: string[] = [];
    let modelFailovers = 0;
    /**
     * The models this reply may fail over ONTO, in the shared preference order —
     * the tenant's own connected flagships and the plan's curated coding pool.
     *
     * This loop previously had no such surface: its failover was "drop the model pin
     * and let the cascade re-route", guarded by `if (… && activeModel)`. On the DEFAULT
     * path that guard is false, because a tenant with a connected account is deliberately
     * left UNPINNED so `complete()` seeds their own flagship — so there was no pin to
     * drop and the branch was unreachable. Measured on project 11 / chat 86: 11 model
     * turns, ONE model (`xai-oauth/grok-4.3`), zero tool calls, zero failovers, and a
     * closing notice telling the user to go pick a different model by hand — which is
     * precisely the work this branch exists to do for them.
     *
     * `data` (the general plan pool) is deliberately OMITTED: this is an agentic tool
     * turn, and a tool loop that falls onto a non-coder flails and ships nothing — the
     * same reason the proxy above is built `codingOnly`.
     */
    const fallbackSurface: ModelFallbackSurface = {
      codingModels: codingModelsForPlan(plan.effectivePlan, plan.premiumOverride),
      byo: { models: byoAutoSeedModels(byoVendors, { agentic: true }).map((id) => ({ id })) },
    };
    let lastModel = pinnedModel ?? '';
    let lastFinish = '';
    // Auto-compact the running transcript BEFORE each paid turn so a tool-heavy reply
    // (every tool result JSON is re-sent every turn) never balloons the request into
    // context exhaustion / a 413 failover onto a weaker model — the same guard the
    // cloud coding loop uses (cloudAgentEngine → compactMessages). Summarizes the bulky
    // MIDDLE into a concise memory (system + task + recent turns kept verbatim, tool
    // pairing preserved), falling back to elision if the summarizer is unavailable.
    const summarize = buildGatewaySummarizer(env);
    for (let i = 0; i < MAX_ITERS; i++) {
      iterations = i + 1;
      const compaction = await compactMessages(convo, CLOUD_COMPACT_DEFAULTS, summarize);
      if (compaction.compacted) convo.splice(0, convo.length, ...compaction.messages);
      const result = await service.complete({
        model: activeModel,
        messages: convo as never,
        tools,
        temperature: replyTemp,
        max_tokens: 1200,
      });
      this.recordUsage(apiKey, tenantId, 'brain_agent_reply', result);
      lastModel = readModel(result) || lastModel;
      lastVendor = readVendor(result) || lastVendor;
      lastByoFunded = readByoFunded(result);
      noteByoFailure(result);
      // ProxyResult.response is an HTTP Response — the body MUST be parsed (readProxyChoice),
      // NOT read as if it were the choices envelope (that silently empties every reply).
      const { message, content, toolCalls, finishReason } = await readProxyChoice(result);
      lastFinish = finishReason || lastFinish;
      // The MODEL turn itself, recorded whether or not it called anything. A turn with
      // `toolCalls: 0` and prose that merely names tools is the announced-but-untaken
      // stall, and without this row it is indistinguishable from a turn whose tools all
      // failed — the two have opposite fixes.
      trace.push({
        kind: 'llm',
        label: readModel(result) || activeModel || '(gateway default)',
        result: {
          finishReason,
          toolCalls: toolCalls.length,
          toolNames: toolCalls.map((tc) => tc.function.name),
          replyChars: content.length,
          advertisedTools: tools.length,
        },
        turnSeq: iterations,
      });

      if (toolCalls.length === 0) {
        // The model ANNOUNCED an action and then ended the turn without taking it
        // ("I'll search the codebase…" → finish: stop, 0 tool calls) — or returned
        // nothing at all. Breaking here hands the user a promise, or a 400, as the
        // answer. Re-prompt instead, bounded per reply by the shared budget. Same gate
        // + wording as the Brain run loop and the cloud agent loop (`agent-stall`).
        const stallInput = {
          text: content,
          toolCallCount: 0,
          availableToolCount: tools.length,
          recoveriesUsed: announcementRecoveries,
        };
        // Which SHAPE, so the notices describe what actually happened. A blank turn told
        // the operator its model had "described tool calls instead of making them" —
        // narration they could not find anywhere in the transcript, because there was none.
        const blank = isEmptyTurn(stallInput);
        if (shouldRecoverStalledTurn(stallInput)) {
          announcementRecoveries += 1;
          convo.push({ role: 'assistant', content });
          convo.push({
            role: 'user',
            content: stallRecoveryNudge(announcementRecoveries >= MAX_ANNOUNCEMENT_RECOVERIES),
          });
          continue;
        }
        // Every recovery spent and the reply is STILL only a description of calls it
        // never made. Re-prompting THIS model is finished — so move to a DIFFERENT one
        // rather than hand the requester a promise dressed as an answer.
        if (isExhaustedStall(stallInput)) {
          // The SHARED decision — record both the asked-for and the resolved model, check
          // the budget, pick a genuinely different route. Identical to the Brain run
          // loop's, because it is the same function.
          const next = chooseStallFailover({
            activeModel,
            resolvedModel: lastModel,
            tried: triedModels,
            failoversUsed: modelFailovers,
            surface: fallbackSurface,
          });
          if (next) {
            modelFailovers += 1;
            // Traced, because a chat that quietly changes model is its own support
            // ticket — and because the diagnostics report cannot otherwise tell a
            // failover that happened from one that never ran.
            // A DISTINCT kind, not another `llm` row: it records a decision, not a model
            // turn, and counting it as one would corrupt the "every turn was toolless"
            // rollup the diagnostics report computes.
            trace.push({
              kind: 'failover',
              label: next,
              args: { from: lastModel || activeModel || null, to: next, attempt: modelFailovers, of: MAX_MODEL_FAILOVERS },
              result: { notice: modelFailoverNotice(lastModel || activeModel, next, blank) },
              turnSeq: iterations,
            });
            activeModel = next;
            // The new model starts with a full stall budget — the old one's failures say
            // nothing about this one, and carrying the count over would give it no chance.
            announcementRecoveries = 0;
            convo.push({ role: 'assistant', content });
            convo.push({ role: 'user', content: stallRecoveryNudge(false) });
            continue;
          }
          // A blank turn leaves no `content` to lead with, so the notice IS the reply —
          // and it is a far better one than the 400 this used to fall through to.
          const notice = stallExhaustedNotice(lastModel, triedModels, blank);
          text = content ? `${content}\n\n${notice}` : notice;
          break;
        }
        text = content;
        break;
      }

      // `ask_user` is a TERMINAL turn: the agent is blocked on the user's decision, so
      // stop the loop and return the question (any lead-in prose + the canonical
      // ```ask-user block the UI renders as a clickable card). Falls through to prose
      // when the args are malformed, so a question is never swallowed.
      const askCall = toolCalls.find((tc) => tc.function.name === ASK_USER_TOOL);
      if (askCall) {
        let block: string | null = null;
        try { block = askUserBlock(JSON.parse(askCall.function.arguments || '{}')); } catch { block = null; }
        if (block) {
          const lead = (message?.content ?? '').trim();
          text = lead ? `${lead}\n\n${block}` : block;
          break;
        }
        // Malformed ask_user → keep any prose the model wrote and stop asking so we
        // don't loop; the empty-turn synthesis below covers a bare call.
        if (message?.content?.trim()) { text = message.content.trim(); break; }
      }

      // Echo the assistant tool-call turn, then execute each call and feed results.
      toolCallCount += toolCalls.length;
      convo.push({ role: 'assistant', content: message?.content ?? '', tool_calls: toolCalls });
      for (const tc of toolCalls) {
        if (tc.function.name === ASK_USER_TOOL) {
          // Reached only when ask_user args were malformed AND the model wrote no prose.
          // Emit a corrective tool result (so the call isn't left unanswered) telling it
          // to retry with a valid question + options, or just answer in prose.
          convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify({ error: 'ask_user needs { question, options:[{label}] } with 2+ options. Retry or answer in prose.' }) });
          continue;
        }
        const toolId = nameToTool.get(tc.function.name) ?? tc.function.name;
        let out: unknown;
        let isError = false;
        const startedAt = Date.now();
        let argObj: unknown = {};
        try {
          argObj = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
          out = await callBuiltinTool(this.db, {
            tenantId, tool: toolId, arguments: argObj as Record<string, unknown>, env,
            userId, role: opts?.role as never, authToken: opts?.authToken, executionCtx: opts?.executionCtx,
          });
        } catch (e) {
          isError = true;
          out = { error: e instanceof Error ? e.message : 'tool call failed' };
        }
        // The CATALOG id is the label, not the advertised name: it is what a reader greps
        // for and what the prompt/allowlist are written in. A name the model invented that
        // resolves to nothing lands here verbatim, which is itself the diagnosis.
        trace.push({
          kind: 'tool', label: toolId, args: argObj, result: out,
          isError, durationMs: Date.now() - startedAt, turnSeq: iterations,
        });
        convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out ?? null).slice(0, 8000) });
      }
    }

    // The tool loop ended with no prose (only tool calls across every iteration, or a
    // model that returned an empty turn): force ONE final synthesis WITHOUT tools so
    // the agent always speaks — a bounded extra call, not another tool round.
    if (!text) {
      const finalResult = await service.complete({
        // `activeModel`, NOT the original pin: when the loop above failed over, the pin
        // names a model that has already proven it cannot do this turn, and re-pinning it
        // for the one call that must produce the user's answer throws the failover away.
        model: activeModel,
        messages: [...convo, { role: 'user', content: `Now write your reply to the team AS ${agentName}: plain prose, first person, no tool calls. Summarise what you found or did.` }] as never,
        temperature: replyTemp,
        max_tokens: 1000,
      });
      this.recordUsage(apiKey, tenantId, 'brain_agent_reply', finalResult);
      lastModel = readModel(finalResult) || lastModel;
      lastVendor = readVendor(finalResult) || lastVendor;
      lastByoFunded = readByoFunded(finalResult);
      noteByoFailure(finalResult);
      const finalChoice = await readProxyChoice(finalResult);
      lastFinish = finalChoice.finishReason || lastFinish;
      text = finalChoice.content;
      // Traced like every other model turn. This is the call that decides whether the
      // reply exists at all, and it was the ONLY one leaving no row — so an empty reply
      // produced HERE was invisible to the diagnostics report that exists to explain it.
      trace.push({
        kind: 'llm',
        label: readModel(finalResult) || activeModel || '(gateway default)',
        args: { synthesis: true },
        // No `advertisedTools`: this call is made WITHOUT tools by construction, and the
        // rollup reads the newest row that reports the field — writing 0 here would make
        // the report claim the manager was offered no tools at all.
        result: {
          finishReason: finalChoice.finishReason,
          toolCalls: 0,
          toolNames: [],
          replyChars: finalChoice.content.length,
        },
        turnSeq: iterations + 1,
      });
    }

    // ── Run this reply ON the project's Evermind (opt-in inference) ────────────
    // When the project opted into running on its own self-learning model, regenerate
    // the FINAL user-facing prose on its Evermind so the learned voice/knowledge shapes
    // the answer — while the tool-loop above stayed on the capable coding model (the tiny
    // SSM can't tool-call, so it never drives tool selection). SOFT pin: passing
    // `evermind/<ref>` WITHOUT modelStrict makes complete() try Evermind first and CASCADE
    // to the coding pool on error; we ADOPT the Evermind turn only when Evermind ITSELF
    // served a substantive AND coherent reply (resolved model still `evermind/`, ≥20 chars,
    // passes `looksLikeCoherentText`) — otherwise we keep the capable-model answer. So an
    // under-trained head can never make the agent reply in gibberish, enabling inference can
    // never break or blank a reply, and a successful turn carries the "🧠 Evermind vN" chip.
    // [[evermind-learning-architecture]]
    let evermindRun: { version: number } | undefined;
    if (text && projectHint != null) {
      const head = await getProjectEvermindHead(env, this.db, tenantId, projectHint).catch(() => null);
      if (head?.inferenceEnabled && head.version >= 1 && head.ref) {
        const evResult = await service.complete({
          model: `evermind/${head.ref}`,
          messages: [...convo, { role: 'user', content: `Write your reply to the team AS ${agentName}: plain prose, first person, no tool calls. Summarise what you found or did.` }] as never,
          temperature: replyTemp,
          max_tokens: 1000,
        });
        this.recordUsage(apiKey, tenantId, 'brain_agent_reply', evResult);
        const evModel = readModel(evResult);
        const evChoice = await readProxyChoice(evResult);
        // Adopt the Evermind turn ONLY when it served a substantive AND coherent reply
        // (same bar the memory-first resolver uses — DRY). An under-trained head emits
        // gibberish that clears the length check; keep the capable-model answer instead.
        const evRan = evModel.startsWith('evermind/'); // false if it cascaded to a real model
        // The transcript is passed as context so domain jargon the conversation already
        // uses is never mistaken for the invented-word gibberish the gate hunts for.
        const evCoherent = evRan && isServableText(evChoice.content, { context: transcript }).coherent;
        // Feed the outcome to the head's quarantine counter (only when Evermind ITSELF
        // ran — a cascade-away isn't the SSM's output). N incoherent serves in a row
        // auto-disable inference so a broken head stops answering in gibberish.
        if (evRan) {
          await recordEvermindServeOutcome(env, this.db, tenantId, projectHint, evCoherent).catch((error) => { /* best-effort */ 
            reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "agentReply" });
          });
        }
        if (evCoherent) {
          text = evChoice.content;
          lastModel = evModel;
          lastVendor = readVendor(evResult) || lastVendor;
          lastByoFunded = readByoFunded(evResult);
          evermindRun = { version: head.version };
        }
      }
    }

    // Persist the tool trace for THIS reply — BEFORE the empty-reply branch below, not
    // after it. Until this moved, the trace was written only on the success path, so a
    // turn that produced NO reply — the exact failure the trace exists to explain — threw
    // its own evidence away and left the diagnostics report reading rows from whatever
    // older turn had last succeeded. That is how a support capture taken minutes after a
    // 400 came back describing a two-day-old, already-fixed defect. One bounded append;
    // best-effort by design — a trace failure must never cost an answer or a diagnosis.
    if (trace.length > 0) {
      await this.appendTrace(chatId, trace).catch((error) => {
        reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "agentReply" });
      });
    }

    if (!text) {
      // Actionable diagnostics beat a bare "empty reply": name the account the run
      // used, the model it resolved to, and how much tool work happened — so the user
      // can tell a transient empty turn from a misconfigured agent/account.
      // Name the account HONESTLY from the SAME authoritative signal the provenance
      // chip uses (`byoFunded` — did the tenant's own credential serve the call), not
      // a connected-token-is-present guess: a cascade or base-model pin can land on the
      // shared pool even with a connection. `classifyReplyAccount` is the one place that
      // decision lives, shared with the streaming gateway header.
      const account = classifyReplyAccount(lastByoFunded, hasConnectedAccount);
      const via = account === 'own'
        ? `your connected ${vendorAccountLabel(lastVendor || (lastModel ? vendorForModel(lastModel) : ''))} account`
        : account === 'shared_byo_unused'
          ? 'the shared model pool (your connected account was NOT used for this run)'
          : 'the shared model pool';
      const modelNote = lastModel ? ` (model: ${lastModel})` : '';
      const toolNote = toolCallCount
        ? ` after ${toolCallCount} tool call${toolCallCount === 1 ? '' : 's'} over ${iterations} step${iterations === 1 ? '' : 's'}`
        : '';
      // Surface the model's finish_reason so a genuinely-empty completion is self-describing:
      // `length` ⇒ the token budget was exhausted (e.g. a reasoning model spent it thinking);
      // `stop`/`end_turn` ⇒ the model chose to say nothing. Distinguishes a config/prompt
      // problem from a transient blank.
      const finishNote = lastFinish && lastFinish !== 'stop' ? ` (finish_reason: ${lastFinish})` : '';
      // If a connected account was TRIED and failed (so the cascade moved on), say so
      // with its status — an expired/revoked subscription 401s, a bad request 400s. This
      // turns a mystifying "empty reply" into a fix ("reconnect your Claude account").
      // `byoFailure` is null when the connected account served fine (or none exists).
      const bf = byoFailure as { vendor: string; code: number; detail?: string } | null;
      // `code: 0` means the vendor `fetch()` threw before any HTTP response — the status
      // alone ("no response") hides the cause, so surface the thrown detail (e.g.
      // `network: <cause>`) which is the ONLY thing that distinguishes a transport/request
      // failure from an auth rejection. Auth statuses keep their reconnect hint.
      const bfCause = bf
        ? bf.code === 401 || bf.code === 403
          ? ` — the token looks expired or revoked; reconnect it in Settings ▸ API Keys`
          : bf.code === 0 && bf.detail
            ? ` — ${bf.detail}`
            : ''
        : '';
      // Where the run went AFTER that failure, read off the SAME classification that
      // produced `via` — not assumed. A tenant with several connected accounts cascades
      // from the failed one onto ANOTHER OF THEIR OWN, and this sentence used to assert
      // "fell back to the shared pool" unconditionally: the shipped ticket read
      // "ran on your connected provider account … so the run fell back to the shared
      // pool", two contradictory claims about the same turn in the same sentence.
      const fellBackTo = account === 'own'
        ? 'so the run moved to another of your connected accounts'
        : 'so the run fell back to the shared pool';
      const byoNote = bf
        ? ` Your connected ${vendorAccountLabel(bf.vendor)} account was tried first but errored (${bf.code || 'no response'})${bfCause}, ${fellBackTo}.`
        : '';
      return {
        error: `${agentName} ran on ${via}${modelNote} but produced no reply${toolNote}${finishNote}.${byoNote} The model returned an empty turn — this usually clears on a retry. If it persists, set a stronger base model for this agent in Workforce, or confirm your connected account is active.` as const,
      };
    }

    // Attribute the turn to the agent AND record its provenance — the resolved model
    // + whether the tenant's OWN connected account served it — so a SUCCESSFUL reply
    // shows the same "whose account ran this" chip that a streaming Brain turn does,
    // not only the empty-reply diagnostic. `provenance` is the wire key brain-ui's
    // parseMessageProvenance reads.
    const provenance = buildReplyProvenance({
      model: lastModel,
      vendor: lastVendor || undefined,
      byoFunded: lastByoFunded,
      hasConnectedAccount,
      evermind: evermindRun,
    });
    const metadata = JSON.stringify({
      authoredBy: { kind: 'agent', ref: input.agentRef, name: agentName },
      provenance,
    });
    const [posted] = await this.appendRaw(chatId, [{ role: 'assistant', content: text, metadata }]);

    // (The tool trace was persisted above, on BOTH the reply and no-reply paths.)

    // Audit: an agent ACTED in this chat, and on WHICH MODEL. Previously a chat turn
    // wrote no activity row at all, so the audit timeline could not answer "what model
    // did this agent run on" — the provenance existed only on the chat message. Same
    // `provenance` object, projected through the ONE shared metadata builder the gateway
    // default-agent turn also uses. Best-effort by design (recordActivity swallows) —
    // `llm_usage_log` remains the billing source of truth.
    await recordActivity(env, this.db, {
      tenantId,
      projectId: projectHint,
      actor: cloudAgentActor(input.agentRef, agentName),
      verb: 'agent.replied',
      targetType: 'chat',
      targetId: chatId,
      targetLabel: (chat as unknown as { title?: string | null }).title ?? null,
      summary: `${agentName} replied in chat #${chatId}${provenance.model ? ` using ${provenance.model}` : ''}`,
      metadata: buildModelActivityMetadata({
        via: 'brain-chat',
        model: provenance.model,
        vendor: provenance.vendor,
        account: provenance.account,
        byoFunded: lastByoFunded,
        evermind: provenance.evermind,
        // `mode` is what makes this row readable as execution-vs-conversation after
        // the fact: without it every agent turn looks alike and the mode rollup can
        // only count chats, never what happened inside them.
        extra: { chatId, mode: resolveChatMode(chat as { origin?: string | null; mode?: string | null }) },
      }),
    });

    // Contribute this @agent reply to the project's Evermind through the SAME
    // learn-on-persist path the Brain message route uses. Previously the addressed-reply
    // loop persisted via appendRaw DIRECTLY and silently skipped training, so @agent
    // turns never fed the project Evermind (GAP-488). Best-effort; dispatched in the
    // background via the route's executionCtx when present.
    await learnFromPersistedTurns(
      env, this.db, chatId, tenantId, [{ role: 'assistant', content: text }],
      (p) => { if (opts?.executionCtx) opts.executionCtx.waitUntil(p); },
    ).catch((error) => { /* never fail the reply */ 
      reportCaughtError(error, { source: "application/brain/BrainService.ts", operation: "agentReply" });
    });

    return posted ?? { error: 'Failed to post reply' as const };
  }

  // -----------------------------------------------------------------------
  // Message feedback
  // -----------------------------------------------------------------------

  /**
   * Record a thumbs up/down on one assistant reply.
   *
   * TWO writes, deliberately, from ONE click:
   *   1. `metadata.feedback` on the message — the UI's own state, so re-opening the
   *      chat shows the thumb the user pressed. Unchanged behaviour.
   *   2. A durable `llm_action_ratings` row (migration 0465) joining that verdict to
   *      the MODEL that earned it and the MCP tool the turn executed.
   *
   * (2) is what was missing. The thumbs have existed for a long time and every press
   * went only into (1) — a JSON blob, unindexed, with no model attribution — so the
   * platform collected its most direct quality signal and could never answer the
   * question the signal exists for. The model comes off the reply's own provenance
   * metadata, so it is the id the gateway actually resolved, never a guess.
   *
   * The rating write is best-effort inside `recordActionRating`; a telemetry failure
   * must not fail the click.
   */
  async setMessageFeedback(
    env: Env,
    messageId: number,
    tenantId: number,
    userId: string,
    feedback: MessageFeedback,
    /** What the client knows about the rated turn that the row does not: which MCP
     *  tool ran, and the action bucket. Both optional — a prose-only reply has no
     *  tool, and "it answered badly" is still a rateable outcome. */
    context?: { toolName?: string | null; actionType?: string | null },
  ) {
    // Find the message and verify ownership through its chat
    const [msg] = await this.db
      .select({
        id: brainChatMessages.id,
        chatId: brainChatMessages.chatId,
        metadata: brainChatMessages.metadata,
      })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.id, messageId));
    if (!msg) return { error: 'Message not found' as const };

    // Verify access to the parent chat (owner or member). The chat's project scopes
    // the rating so project-level routing learns from it.
    const chat = await this.canAccessChat(msg.chatId, tenantId, userId, { projectId: brainChats.projectId });
    if (!chat) return { error: 'Message not found' as const };

    // Merge feedback into existing metadata JSON
    const existing = msg.metadata ? JSON.parse(msg.metadata) : {};
    existing.feedback = feedback;

    const [updated] = await this.db
      .update(brainChatMessages)
      .set({ metadata: JSON.stringify(existing) })
      .where(eq(brainChatMessages.id, messageId))
      .returning(messageColumns);
    if (!updated) return { error: 'Update failed' as const };

    // The model that actually served this reply, as persisted by the streaming path
    // (see brain-embedded/provenance.ts). Absent on pre-provenance turns — those
    // carry no attribution, so rating them would invent evidence for a model that
    // may never have run, and the row is skipped.
    const model = typeof existing?.provenance?.model === 'string' ? existing.provenance.model : '';
    const plan = await resolveTenantPlan(env, tenantId).then((p) => p.effectivePlan).catch(() => 'free' as const);
    if (model || feedback === null) {
      await recordActionRating(env, this.db, { tenantId, userId, plan }, {
        surface: 'brain',
        subjectKind: 'turn',
        subjectRef: `brain_message:${messageId}`,
        resolvedModel: model,
        toolName: context?.toolName ?? null,
        actionType: context?.actionType ?? undefined,
        projectId: (chat as { projectId?: number | null }).projectId ?? null,
        rating: feedback === 'up' ? 1 : feedback === 'down' ? -1 : 0,
      });
    }

    return updated;
  }

  // -----------------------------------------------------------------------
  // Human members (shared access, migration 0288)
  // -----------------------------------------------------------------------

  /** Active human members of a chat (owner or any member may read the roster). */
  async listMembers(chatId: number, tenantId: number, userId: string) {
    const chat = await this.canAccessChat(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    const rows = await this.db
      .select({
        id: chatMembers.id,
        userId: chatMembers.userId,
        email: chatMembers.invitedEmail,
        status: chatMembers.status,
        name: users.displayName,
        userEmail: users.email,
        role: chatMembers.role,
      })
      .from(chatMembers)
      .leftJoin(users, eq(users.id, chatMembers.userId))
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.tenantId, tenantId)))
      .orderBy(chatMembers.createdAt);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      status: r.status,
      role: r.role,
      email: (r.userEmail ?? r.email ?? '').toLowerCase(),
      name: r.name || r.userEmail || r.email || 'Invited',
    }));
  }

  /**
   * Invite a human to a chat by email (owner only). If the email belongs to an
   * existing member of this tenant the invite is ACTIVE immediately (they get
   * access + a notification); otherwise a PENDING row is written that converts on
   * their next access. Idempotent per (chat, user) / (chat, email). Returns the
   * resolution the route needs to fire the in-app + email notification.
   */
  async inviteHuman(
    chatId: number,
    tenantId: number,
    userId: string,
    input: { email: string },
    /** Needed to invalidate the tenant's cached invitation roster when the
     *  workspace invite is created — `BrainService` holds a `Db`, not an `Env`,
     *  so the caller that has one passes it. */
    env: Env,
  ): Promise<
    | { error: string }
    | { status: 'active' | 'pending'; memberUserId: string | null; email: string; chatTitle: string; already: boolean }
  > {
    const chat = await this.verifyChatOwnership(chatId, tenantId, userId, { title: brainChats.title }) as
      | { id: number; title: string }
      | null;
    if (!chat) return { error: 'Chat not found' };
    const email = input.email?.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'A valid email is required' };

    // Resolve the email to an existing active member of THIS tenant (so their
    // tenant-scoped token can actually reach the chat).
    const [existingUser] = await this.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(tenantMembers, and(eq(tenantMembers.userId, users.id), eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isActive, true)))
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existingUser) {
      if (existingUser.id === userId) return { error: 'You already own this chat' };
      const [dup] = await this.db.select({ id: chatMembers.id })
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, existingUser.id)))
        .limit(1);
      if (!dup) {
        await this.db.insert(chatMembers).values({
          chatId, tenantId, userId: existingUser.id, status: 'active', invitedBy: userId,
        });
      }
      return { status: 'active', memberUserId: existingUser.id, email, chatTitle: chat.title, already: !!dup };
    }

    // Cold invite — pending row keyed on the email, converts on first access.
    const [dup] = await this.db.select({ id: chatMembers.id })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), sql`lower(${chatMembers.invitedEmail}) = ${email}`))
      .limit(1);
    if (!dup) {
      await this.db.insert(chatMembers).values({
        chatId, tenantId, invitedEmail: email, status: 'pending', invitedBy: userId,
      });
      // Also drop a pending TENANT invitation so the cold invitee actually gets a
      // tenant account on signup (the existing tenant-invite auto-conversion adds
      // them to tenant_members). Once in the tenant, syncPendingMemberships promotes
      // their chat membership to active — completing the join with no extra step.
      // Find-or-refresh, in the kernel service that owns the primitive — the
      // select-then-insert this replaced raced with itself and normalised the
      // address on the read but not on the write.
      await invite(this.db, env, {
        tenantId,
        kind: 'tenant',
        email,
        role: 'developer',
        invitedBy: userId,
      });
    }
    return { status: 'pending', memberUserId: null, email, chatTitle: chat.title, already: !!dup };
  }

  /** Remove a human member from a chat (owner only). */
  async removeMember(chatId: number, tenantId: number, userId: string, memberId: number) {
    const chat = await this.verifyChatOwnership(chatId, tenantId, userId);
    if (!chat) return { error: 'Chat not found' as const };
    const rows = await this.db
      .delete(chatMembers)
      .where(and(eq(chatMembers.id, memberId), eq(chatMembers.chatId, chatId), eq(chatMembers.tenantId, tenantId)))
      .returning({ id: chatMembers.id });
    return { removed: rows.length > 0 };
  }

  // -----------------------------------------------------------------------
  // Summarisation
  // -----------------------------------------------------------------------

  async summarizeChat(chatId: number, tenantId: number, userId: string, env: Env) {
    const apiKey = env.OPENROUTER_API_KEY;
    const chat = await this.canAccessChat(chatId, tenantId, userId, {
      projectId: brainChats.projectId,
    }) as { id: number; projectId: number | null } | null;
    if (!chat) return { error: 'Chat not found' as const };

    const msgs = await this.db
      .select({ role: brainChatMessages.role, content: brainChatMessages.content })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(brainChatMessages.seq)
      .limit(500);

    if (msgs.length < 2) {
      return { summary: null, reason: 'Not enough messages to summarize' };
    }

    const transcript = msgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

    const systemPrompt = [
      'You are a summarization assistant. Compress the following conversation into a concise memory.',
      'Focus on: key decisions, action items, ideas proposed, context established, and important details.',
      'Output only the summary, no preamble.',
    ].join('\n');

    const service = await this.buildTenantLlmService(env, tenantId);

    const result = await service.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });
    this.recordUsage(apiKey, tenantId, 'brain_summary', result);

    const { content: summary } = await readProxyChoice(result);

    if (!summary) {
      return { summary: null, reason: 'LLM returned empty response' };
    }

    // Store summary on the unified chat row (Brain Storm chats use brain_chats)
    await this.db
      .update(brainChats)
      .set({ summary, updatedAt: new Date() })
      .where(eq(brainChats.id, chatId));

    return { summary };
  }

  // -----------------------------------------------------------------------
  // Memories
  // -----------------------------------------------------------------------

  async listMemories(tenantId: number, opts?: { projectId?: string; limit?: number }) {
    const conditions = [eq(chatMemories.tenantId, tenantId)];
    if (opts?.projectId) {
      const pid = Number(opts.projectId);
      if (!Number.isNaN(pid)) conditions.push(eq(chatMemories.projectId, pid));
    }

    return this.db
      .select({
        id: chatMemories.id,
        chatId: chatMemories.chatId,
        projectId: chatMemories.projectId,
        summary: chatMemories.summary,
        createdAt: chatMemories.createdAt,
        updatedAt: chatMemories.updatedAt,
      })
      .from(chatMemories)
      .where(and(...conditions))
      .orderBy(desc(chatMemories.updatedAt))
      .limit(Math.min(opts?.limit ?? 50, 200));
  }

  async getProjectMemory(tenantId: number, projectId: number) {
    const [memory] = await this.db
      .select({
        id: projectMemories.id,
        projectId: projectMemories.projectId,
        consolidatedSummary: projectMemories.consolidatedSummary,
        createdAt: projectMemories.createdAt,
        updatedAt: projectMemories.updatedAt,
      })
      .from(projectMemories)
      .where(
        and(
          eq(projectMemories.tenantId, tenantId),
          eq(projectMemories.projectId, projectId),
        ),
      )
      .limit(1);

    return memory ?? null;
  }

  // -----------------------------------------------------------------------
  // Project memory consolidation
  // -----------------------------------------------------------------------

  async consolidateProjectMemory(tenantId: number, projectId: number, env: Env) {
    const apiKey = env.OPENROUTER_API_KEY;
    const proj = await this.verifyProjectInTenant(projectId, tenantId);
    if (!proj) return { error: 'Project not found' as const };

    const memories = await this.db
      .select({ chatId: chatMemories.chatId, summary: chatMemories.summary })
      .from(chatMemories)
      .where(and(eq(chatMemories.tenantId, tenantId), eq(chatMemories.projectId, projectId)))
      .orderBy(chatMemories.updatedAt)
      .limit(100);

    if (memories.length === 0) {
      return { consolidatedSummary: null, reason: 'No chat memories to consolidate' };
    }

    const memoriesText = memories
      .map((m, i) => `Chat ${i + 1}:\n${m.summary}`)
      .join('\n\n---\n\n');

    const systemPrompt = [
      `You are a project memory consolidator for the project "${proj.name}".`,
      'Combine the following individual chat summaries into a single, coherent project memory.',
      'Focus on: overall project context, key decisions across all chats, established patterns,',
      'action items, and important details. Remove redundancy. Be concise but comprehensive.',
      'Output only the consolidated memory, no preamble.',
    ].join('\n');

    const service = await this.buildTenantLlmService(env, tenantId);

    const result = await service.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: memoriesText },
      ],
      temperature: 0.2,
      max_tokens: 1200,
    });
    this.recordUsage(apiKey, tenantId, 'brain_project_memory', result);

    const { content: consolidatedSummary } = await readProxyChoice(result);

    if (!consolidatedSummary) {
      return { consolidatedSummary: null, reason: 'LLM returned empty response' };
    }

    await this.db
      .insert(projectMemories)
      .values({ tenantId, projectId, consolidatedSummary })
      .onConflictDoUpdate({
        target: projectMemories.projectId,
        set: { consolidatedSummary, updatedAt: new Date() },
      });

    return { consolidatedSummary };
  }

  // -----------------------------------------------------------------------
  // AgentHost session summarisation — bridges agentHost chat history into brain memory
  // -----------------------------------------------------------------------

  async summarizeAgentHostSession(sessionId: number, tenantId: number, env: Env) {
    const apiKey = env.OPENROUTER_API_KEY;
    // Verify session belongs to tenant
    const [session] = await this.db
      .select({
        id: chatSessions.id,
        projectId: chatSessions.projectId,
        agentHostId: chatSessions.agentHostId,
      })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.tenantId, tenantId)))
      .limit(1);

    if (!session) return { error: 'Session not found' as const };

    const msgs = await this.db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.seq)
      .limit(500);

    if (msgs.length < 2) {
      return { summary: null, reason: 'Not enough messages to summarize' };
    }

    const transcript = msgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

    const systemPrompt = [
      'You are a summarization assistant. Compress the following agentHost coding session into a concise memory.',
      'Focus on: what was worked on, key decisions, code changes, bugs found, and important context.',
      'Output only the summary, no preamble.',
    ].join('\n');

    const service = await this.buildTenantLlmService(env, tenantId);

    const result = await service.complete({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });
    this.recordUsage(apiKey, tenantId, 'brain_summary', result);

    const { content: summary } = await readProxyChoice(result);

    if (!summary) {
      return { summary: null, reason: 'LLM returned empty response' };
    }

    // Store in chatMemories linked via agentHostSessionId for project memory consolidation
    await this.db
      .insert(chatMemories)
      .values({
        tenantId,
        agentHostSessionId: sessionId,
        projectId: session.projectId,
        summary,
      })
      .onConflictDoUpdate({
        target: chatMemories.agentHostSessionId,
        set: { summary, projectId: session.projectId, updatedAt: new Date() },
      });

    return { summary, projectId: session.projectId };
  }
}
