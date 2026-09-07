/**
 * The chat↔ticket REST adapter — ONE implementation, both hosts.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `ChatTicketsAdapter` was implemented twice against the same endpoints:
 * `frontend/src/components/brain/ChatTicketsPanel.tsx` for the web app and
 * `clients/vscode/webview/src/chatTicketsAdapter.ts` for the VS Code webview.
 * Same `/api/brain/*`, `/api/tasks`, `/api/approvals`, `/api/workforce` calls —
 * and the copies had drifted where it MATTERED, not just cosmetically:
 *
 *   • the webview's `runTicket` never invited the agent into the chat, and never
 *     passed `chatId` to `run-now`. A chat-dispatched agent therefore ran
 *     invisibly: it narrated nowhere and was unreachable from the very
 *     conversation that asked for it.
 *   • the webview's `listQuestions` filter and the web's had to be kept in step
 *     by hand — two copies of "which link kinds are runnable".
 *
 * Behaviour belongs to the panel, so it lives beside the panel. What genuinely
 * differs per host is injected: how an authenticated call is made, and whether
 * this surface may dispatch a run at all.
 */
import { RUNNABLE_KINDS } from './types';
import type {
  AgentOptionVM,
  ChatQuestionVM,
  ChatTicketsAdapter,
  LineageVM,
  TicketLinkVM,
  TicketOptionVM,
} from './types';

/** An authenticated JSON call, relative to the gateway origin. */
export type ChatTicketsRequest = <T>(path: string, init?: { method?: string; body?: BodyInit }) => Promise<T>;

export interface ChatTicketsRestOptions {
  /** How this host makes an authenticated JSON call. */
  request: ChatTicketsRequest;
  /**
   * Whether this surface may dispatch a run, and if not, why.
   *
   * Asked of the host because it is the one thing neither this package nor the
   * gateway response can answer: the web app gates on the `runtime.execute`
   * tenant role, and the VS Code webview has no tenant-role context at all.
   * Omitted means permitted — which is the VSIX's existing behaviour, and the
   * server still refuses on its own authority.
   */
  canRun?: () => { allowed: boolean; reason?: string };
}

/** The package already declares which link kinds name a runnable ticket, and the
 *  panel gates its Run affordance on the same list — so the question filter reads
 *  it rather than restating it. */
const RUNNABLE = new Set(RUNNABLE_KINDS);

interface WorkforceAgent { id: string | number; name: string; title?: string; base_model?: string }
interface RegisteredAgent { id: string | number; name: string; type: string; isActive: boolean }

export function createChatTicketsRestAdapter(opts: ChatTicketsRestOptions): ChatTicketsAdapter {
  const { request: req } = opts;

  /**
   * The agent pool is stable tenant data (which agents EXIST), unchanged by
   * invite/remove — so the three-endpoint fan-out is resolved once for the
   * adapter's lifetime. Both the panel and the composer's recipient picker read
   * it, so this dedups what would otherwise be a duplicate 3-request fetch.
   * Reset on failure so a transient error can be retried.
   */
  let poolPromise: Promise<AgentOptionVM[]> | null = null;
  const fetchAgentPool = async (): Promise<AgentOptionVM[]> => {
    const [mine, purchased, registered] = await Promise.all([
      req<WorkforceAgent[]>('/api/workforce/agents/mine').catch(() => [] as WorkforceAgent[]),
      req<WorkforceAgent[]>('/api/workforce/agents/purchased').catch(() => [] as WorkforceAgent[]),
      req<RegisteredAgent[]>('/api/agents').catch(() => [] as RegisteredAgent[]),
    ]);
    const wfById = new Map<string, WorkforceAgent>();
    for (const agent of [...mine, ...purchased]) wfById.set(String(agent.id), agent);
    const workforce: AgentOptionVM[] = [...wfById.values()].map((a) => ({
      kind: 'workforce', ref: String(a.id), name: a.name, meta: a.title || a.base_model || '',
    }));
    const agents: AgentOptionVM[] = registered
      .filter((a) => a.isActive)
      .map((a) => ({ kind: 'registered', ref: String(a.id), name: a.name, meta: a.type }));
    return [...workforce, ...agents];
  };

  return {
    listTickets: (chatId) =>
      req<{ tickets: TicketLinkVM[] }>(`/api/brain/chats/${chatId}/tickets`).then((r) => r.tickets),

    linkTicket: (chatId, input) =>
      req(`/api/brain/chats/${chatId}/tickets`, { method: 'POST', body: JSON.stringify(input) }).then(() => undefined),

    unlinkTicket: (chatId, kind, ref) =>
      req(
        `/api/brain/chats/${chatId}/tickets?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref)}`,
        { method: 'DELETE' },
      ).then(() => undefined),

    listTicketChats: (kind, ref) =>
      req<{ chats: LineageVM[] }>(
        `/api/brain/tickets/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}/chats`,
      ).then((r) => r.chats.map((c) => ({
        chatId: c.chatId, title: c.title, linkType: c.linkType, isArchived: c.isArchived,
      }))),

    consolidate: (targetChatId, sourceChatIds) =>
      req('/api/brain/chats/consolidate', {
        method: 'POST',
        body: JSON.stringify({ targetChatId, sourceChatIds }),
      }).then(() => undefined),

    listAgents: (chatId) =>
      req<{ agents: Array<{ id: string; agentRef: string; role: string }> }>(`/api/brain/chats/${chatId}/agents`)
        .then((r) => r.agents.map((a) => ({ id: a.id, agentRef: a.agentRef, role: a.role }))),

    inviteAgent: (chatId, input) =>
      req(`/api/brain/chats/${chatId}/agents`, { method: 'POST', body: JSON.stringify(input) }).then(() => undefined),

    removeAgent: (chatId, assignmentId) =>
      req(`/api/brain/chats/${chatId}/agents/${assignmentId}`, { method: 'DELETE' }).then(() => undefined),

    listMembers: (chatId) =>
      req<{ members: Array<{ id: number; userId: string | null; name: string; email: string; status: string }> }>(
        `/api/brain/chats/${chatId}/members`,
      ).then((r) => r.members),

    inviteMember: (chatId, email) =>
      req<{ status: string }>(`/api/brain/chats/${chatId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      }).then((r) => ({ status: r.status })),

    removeMember: (chatId, memberId) =>
      req(`/api/brain/chats/${chatId}/members/${memberId}`, { method: 'DELETE' }).then(() => undefined),

    loadAgentPool: () => {
      if (!poolPromise) poolPromise = fetchAgentPool().catch((error) => { poolPromise = null; throw error; });
      return poolPromise;
    },

    /** Server-side typeahead per tier (the shared LinkForm debounces). Replaces the
     *  old fan-out that fetched EVERY task/objective/initiative/portfolio/roadmap/spec. */
    searchTickets: async (kind, query, projectId): Promise<TicketOptionVM[]> => {
      const qs = new URLSearchParams({ kind, q: query });
      if (projectId != null) qs.set('project_id', String(projectId));
      const r = await req<{ results: TicketOptionVM[] }>(`/api/brain/tickets/search?${qs.toString()}`)
        .catch(() => ({ results: [] as TicketOptionVM[] }));
      return r.results ?? [];
    },

    ...(opts.canRun ? { canRunTicket: opts.canRun } : {}),

    /**
     * "Tag to execute" — three steps, in this order, and all three matter:
     *
     *  1. INVITE the agent into the chat. Without it the agent is not a
     *     participant, so its reply has nowhere to be attributed.
     *  2. ASSIGN it to the ticket, so the board shows who is working it.
     *  3. RUN, bound to THIS chat. Without `chatId` the run narrates nowhere and
     *     is unreachable from the conversation that asked for it — which is
     *     exactly what the VS Code copy of this adapter did.
     *
     * The capability probe is what DISABLES the affordance; the throw here is the
     * enforcement backstop, for a stale render or a role that changed between
     * paint and click.
     */
    runTicket: async (_kind, ref, agentRef, chatId) => {
      const gate = opts.canRun?.();
      if (gate && !gate.allowed) throw new Error(gate.reason ?? 'Running a ticket is not permitted here.');
      const id = Number(ref);
      // Best-effort: already a participant is not an error, and a failure to
      // invite must not stop the run the user asked for.
      await req(`/api/brain/chats/${chatId}/agents`, {
        method: 'POST',
        body: JSON.stringify({ agentRef }),
      }).catch(() => undefined);
      await req(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ assignedAgentRef: agentRef }) });
      const res = await req<{ ok: boolean; executionId: number | null; agentRef: string | null }>(
        `/api/tasks/${id}/run-now`,
        { method: 'POST', body: JSON.stringify({ chatId }) },
      );
      return { started: !!res.executionId, agentName: res.agentRef };
    },

    listQuestions: async (chatId): Promise<ChatQuestionVM[]> => {
      const [links, pending] = await Promise.all([
        req<{ tickets: TicketLinkVM[] }>(`/api/brain/chats/${chatId}/tickets`).then((r) => r.tickets),
        // `kind` is on the wire but not on the VM — the panel renders a question
        // without caring which flavour it is, while the FILTER cares about nothing
        // else. Typing the wire row here keeps both true.
        req<{ approvals: Array<ChatQuestionVM & { kind: string }> }>('/api/approvals?status=pending').then((r) => r.approvals),
      ]);
      const taskIds = new Set(
        links.filter((link) => RUNNABLE.has(link.kind)).map((link) => Number(link.ref)),
      );
      return pending.filter((q) =>
        (q.kind === 'question' || q.kind === 'feedback') && q.taskId != null && taskIds.has(q.taskId));
    },

    answerQuestion: (id, responseText) =>
      req(`/api/approvals/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'answered', responseText }),
      }).then(() => undefined),
  };
}
