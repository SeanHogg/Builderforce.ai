'use client';

/**
 * ChatTicketsPanel (web) — a thin host wrapper around the SHARED
 * `@seanhogg/builderforce-brain-ui` ChatTicketsPanel. All the UI lives in the
 * shared package (rendered identically in the VS Code webview); here we only:
 *   1. build the data `adapter` from the web's `brain.*` / `pmoApi` / `tasksApi`
 *      / `loadAgentPool` clients (this is also where the strategy-tier — OKR /
 *      initiative / portfolio — picker options come from), and
 *   2. map the next-intl `brain.tickets` catalog into the shared labels bundle.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChatTicketsPanel as SharedChatTicketsPanel,
  type ChatTicketsAdapter, type ChatTicketsLabels, type TicketKind, type TicketOptionVM,
} from '@seanhogg/builderforce-brain-ui';
import {
  brain, tasksApi, pmoApi,
  type BrainChat, type ChatTicketLink, type ChatAgentInvite, type Task,
  type Objective, type Initiative, type Portfolio,
} from '@/lib/builderforceApi';
import { loadAgentPool } from '@/lib/agentPool';

export function ChatTicketsPanel({ chatId, projectId, chatList, onChanged }: {
  chatId: number;
  projectId: number | null;
  chatList: BrainChat[];
  onChanged?: () => void;
}) {
  const t = useTranslations('brain.tickets');

  const labels = useMemo<ChatTicketsLabels>(() => ({
    none: t('none'), spawned: t('spawned'), run: t('run'), lineage: t('lineage'), unlink: t('unlink'),
    pickAgent: t('pickAgent'), lineageTitle: t('lineageTitle'), lineageEmpty: t('lineageEmpty'), merged: t('merged'),
    runNoAgent: t('runNoAgent'), runFailed: t('runFailed'), link: t('link'), agents: t('agents'), merge: t('merge'),
    linkFailed: t('linkFailed'), kindLabel: t('kindLabel'), pickTicket: t('pickTicket'), linkTypeLabel: t('linkTypeLabel'),
    linkTypeLinked: t('linkTypeLinked'), linkTypeCreated: t('linkTypeCreated'), linkAction: t('linkAction'),
    noAgents: t('noAgents'), removeAgent: t('removeAgent'), inviteAgent: t('inviteAgent'), agentsHint: t('agentsHint'),
    mergeHint: t('mergeHint'), mergeNoOthers: t('mergeNoOthers'),
    kind: { task: t('kind.task'), epic: t('kind.epic'), objective: t('kind.objective'), initiative: t('kind.initiative'), portfolio: t('kind.portfolio') },
    ringAria: (label, pct) => t('ringAria', { label, pct }),
    runStarted: (agent) => t('runStarted', { agent }),
    mergeAction: (n) => t('mergeAction', { n }),
    mergedN: (n) => t('mergedN', { n }),
  }), [t]);

  const adapter = useMemo<ChatTicketsAdapter>(() => ({
    listTickets: (id) => brain.listChatTickets(id).then((rows) => rows.map(toTicketVM)),
    linkTicket: (id, input) => brain.linkChatTicket(id, input).then(() => undefined),
    unlinkTicket: (id, kind, ref) => brain.unlinkChatTicket(id, kind, ref).then(() => undefined),
    listTicketChats: (kind, ref) => brain.listTicketChats(kind, ref).then((rows) => rows.map((c) => ({ chatId: c.chatId, title: c.title, linkType: c.linkType, isArchived: c.isArchived }))),
    consolidate: (target, sources) => brain.consolidateChats(target, sources).then(() => undefined),
    listAgents: (id) => brain.listChatAgents(id).then((rows) => rows.map((a: ChatAgentInvite) => ({ id: a.id, agentRef: a.agentRef, role: a.role }))),
    inviteAgent: (id, input) => brain.inviteChatAgent(id, input).then(() => undefined),
    removeAgent: (id, assignmentId) => brain.removeChatAgent(id, assignmentId).then(() => undefined),
    loadAgentPool: () => loadAgentPool().then((ps) => ps.map((p) => ({ ref: p.ref, name: p.name, meta: p.meta, kind: p.kind }))),
    loadTicketOptions: async (pid) => {
      // task/epic from the board (project-scoped when known); the strategy tiers
      // (OKR objective / initiative / portfolio) are tenant-wide via the PMO API.
      const [tasks, objectives, initiatives, portfolios] = await Promise.all([
        tasksApi.list(pid ?? undefined).catch(() => [] as Task[]),
        pmoApi.objectives.list().catch(() => [] as Objective[]),
        pmoApi.initiatives.list().catch(() => [] as Initiative[]),
        pmoApi.portfolios.list().catch(() => [] as Portfolio[]),
      ]);
      const taskOpts: TicketOptionVM[] = [];
      const epicOpts: TicketOptionVM[] = [];
      for (const tk of tasks) {
        (tk.taskType === 'epic' ? epicOpts : taskOpts).push({ ref: String(tk.id), label: `${tk.key} — ${tk.title}` });
      }
      return {
        task: taskOpts,
        epic: epicOpts,
        objective: objectives.map((o) => ({ ref: o.id, label: o.title })),
        initiative: initiatives.map((i) => ({ ref: i.id, label: i.name })),
        portfolio: portfolios.map((p) => ({ ref: p.id, label: p.name })),
      } as Record<TicketKind, TicketOptionVM[]>;
    },
    runTicket: async (kind, ref, agentRef) => {
      // "Tag to execute": ensure the agent participates, assign it to the ticket,
      // then start a run — reuses the board's dispatch (assignee + run-now).
      await brain.inviteChatAgent(chatId, { agentRef }).catch(() => {});
      await tasksApi.update(Number(ref), { assignedAgentRef: agentRef });
      const res = await tasksApi.runNow(Number(ref));
      return { started: !!res.executionId, agentName: res.agentRef };
    },
  }), [chatId]);

  return (
    <div style={{ margin: '0 12px' }}>
      <SharedChatTicketsPanel
        chatId={chatId}
        projectId={projectId}
        chatList={chatList.map((c) => ({ id: c.id, title: c.title }))}
        adapter={adapter}
        labels={labels}
        onChanged={onChanged}
      />
    </div>
  );
}

function toTicketVM(r: ChatTicketLink) {
  return {
    linkId: r.linkId, kind: r.kind, ref: r.ref, label: r.label, status: r.status,
    progressPct: r.progressPct, done: r.done, total: r.total, exists: r.exists, linkType: r.linkType,
  };
}
