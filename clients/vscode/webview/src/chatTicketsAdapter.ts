/**
 * The VS Code webview's chat↔ticket data adapter — wires the SHARED
 * `@seanhogg/builderforce-brain-ui` ChatTicketsPanel to the gateway over the same
 * bearer-fetch the Brain persistence uses (CORS allows the `vscode-webview://`
 * origin). Same `/api/brain/*`, `/api/tasks`, `/api/pmo/*` endpoints the web app's
 * panel calls — one unified surface, two hosts.
 */
import type {
  ChatTicketsAdapter, TicketKind, TicketOptionVM, TicketLinkVM, AgentOptionVM,
} from '@seanhogg/builderforce-brain-ui';
import { authedFetch } from './authedFetch';

interface WorkforceAgent { id: string | number; name: string; title?: string; base_model?: string }
interface RegisteredAgent { id: string | number; name: string; type: string; isActive: boolean }
interface TaskRow { id: number; key: string; title: string; taskType: 'task' | 'epic' }
interface StrategyRow { id: string; title?: string; name?: string }

export function createChatTicketsAdapter(
  baseUrl: string,
  getToken: () => string | null,
  onUnauthorized: () => void,
): ChatTicketsAdapter {
  const req = authedFetch(baseUrl, getToken, onUnauthorized);

  return {
    listTickets: (chatId) =>
      req<{ tickets: TicketLinkVM[] }>(`/api/brain/chats/${chatId}/tickets`).then((r) => r.tickets),
    linkTicket: (chatId, input) =>
      req(`/api/brain/chats/${chatId}/tickets`, { method: 'POST', body: JSON.stringify(input) }).then(() => undefined),
    unlinkTicket: (chatId, kind, ref) =>
      req(`/api/brain/chats/${chatId}/tickets?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref)}`, { method: 'DELETE' }).then(() => undefined),
    listTicketChats: (kind, ref) =>
      req<{ chats: Array<{ chatId: number; title: string; linkType: 'linked' | 'created'; isArchived: boolean }> }>(
        `/api/brain/tickets/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}/chats`,
      ).then((r) => r.chats.map((c) => ({ chatId: c.chatId, title: c.title, linkType: c.linkType, isArchived: c.isArchived }))),
    consolidate: (target, sources) =>
      req('/api/brain/chats/consolidate', { method: 'POST', body: JSON.stringify({ targetChatId: target, sourceChatIds: sources }) }).then(() => undefined),
    listAgents: (chatId) =>
      req<{ agents: Array<{ id: string; agentRef: string; role: string }> }>(`/api/brain/chats/${chatId}/agents`)
        .then((r) => r.agents.map((a) => ({ id: a.id, agentRef: a.agentRef, role: a.role }))),
    inviteAgent: (chatId, input) =>
      req(`/api/brain/chats/${chatId}/agents`, { method: 'POST', body: JSON.stringify(input) }).then(() => undefined),
    removeAgent: (chatId, assignmentId) =>
      req(`/api/brain/chats/${chatId}/agents/${assignmentId}`, { method: 'DELETE' }).then(() => undefined),
    loadAgentPool: async (): Promise<AgentOptionVM[]> => {
      const [mine, purchased, registered] = await Promise.all([
        req<WorkforceAgent[]>('/api/workforce/agents/mine').catch(() => [] as WorkforceAgent[]),
        req<WorkforceAgent[]>('/api/workforce/agents/purchased').catch(() => [] as WorkforceAgent[]),
        req<RegisteredAgent[]>('/api/agents').catch(() => [] as RegisteredAgent[]),
      ]);
      const wfById = new Map<string, WorkforceAgent>();
      for (const a of [...mine, ...purchased]) wfById.set(String(a.id), a);
      const wf: AgentOptionVM[] = [...wfById.values()].map((a) => ({ kind: 'workforce', ref: String(a.id), name: a.name, meta: a.title || a.base_model || '' }));
      const reg: AgentOptionVM[] = registered.filter((a) => a.isActive).map((a) => ({ kind: 'registered', ref: String(a.id), name: a.name, meta: a.type }));
      return [...wf, ...reg];
    },
    loadTicketOptions: async (projectId): Promise<Record<TicketKind, TicketOptionVM[]>> => {
      const q = projectId != null ? `?project_id=${projectId}` : '';
      const [tasks, objectives, initiatives, portfolios] = await Promise.all([
        req<{ tasks: TaskRow[] }>(`/api/tasks${q}`).then((r) => r.tasks ?? []).catch(() => [] as TaskRow[]),
        req<StrategyRow[]>('/api/pmo/objectives').catch(() => [] as StrategyRow[]),
        req<StrategyRow[]>('/api/pmo/initiatives').catch(() => [] as StrategyRow[]),
        req<StrategyRow[]>('/api/pmo/portfolios').catch(() => [] as StrategyRow[]),
      ]);
      const task: TicketOptionVM[] = [];
      const epic: TicketOptionVM[] = [];
      for (const tk of tasks) (tk.taskType === 'epic' ? epic : task).push({ ref: String(tk.id), label: `${tk.key} — ${tk.title}` });
      return {
        task, epic,
        objective: objectives.map((o) => ({ ref: o.id, label: o.title ?? o.id })),
        initiative: initiatives.map((i) => ({ ref: i.id, label: i.name ?? i.id })),
        portfolio: portfolios.map((p) => ({ ref: p.id, label: p.name ?? p.id })),
      };
    },
    runTicket: async (_kind, ref, agentRef) => {
      const id = Number(ref);
      await req(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ assignedAgentRef: agentRef }) });
      const res = await req<{ ok: boolean; executionId: number | null; agentRef: string }>(`/api/tasks/${id}/run-now`, { method: 'POST' });
      return { started: !!res.executionId, agentName: res.agentRef };
    },
  };
}
