'use client';

/**
 * ChatTicketsPanel (web) — a thin host wrapper around the SHARED
 * `@seanhogg/builderforce-brain-ui` ChatTicketsPanel. All the UI lives in the
 * shared package (rendered identically in the VS Code webview); here we only:
 *   1. build the data `adapter` from the web's `brain.*` / `tasksApi` /
 *      `loadAgentPool` clients (the link-picker typeahead is served by the shared
 *      `brain.searchTickets` → `GET /api/brain/tickets/search`), and
 *   2. map the next-intl `brain.tickets` catalog into the shared labels bundle.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChatTicketsPanel as SharedChatTicketsPanel,
  type ChatTicketsAdapter, type ChatTicketsLabels,
} from '@seanhogg/builderforce-brain-ui';
import {
  brain, tasksApi,
  type BrainChat, type ChatTicketLink, type ChatAgentInvite,
} from '@/lib/builderforceApi';
import { loadAgentPool } from '@/lib/agentPool';
import { onBrainDataChanged } from '@/lib/brain/brainDataEvent';

export function ChatTicketsPanel({ chatId, projectId, chatList, onChanged }: {
  chatId: number;
  projectId: number | null;
  chatList: BrainChat[];
  onChanged?: () => void;
}) {
  const t = useTranslations('brain.tickets');

  // Live-refresh when the Brain mutates work items via MCP tools (link/merge/
  // invite, or a task move that changes a health ring) — not just our own actions.
  const [refreshSignal, setRefreshSignal] = useState(0);
  useEffect(() => onBrainDataChanged(['chats', 'brain', 'tasks'], () => setRefreshSignal((n) => n + 1)), []);

  // LOCK state — owner-only toggle. Read once per chat (also picks up ownership).
  const [visibility, setVisibility] = useState<'shared' | 'locked'>('shared');
  const [isOwner, setIsOwner] = useState(false);
  useEffect(() => {
    let live = true;
    brain.getChat(chatId).then((c) => {
      if (!live) return;
      const meta = c as unknown as { visibility?: 'shared' | 'locked'; isOwner?: boolean };
      setVisibility(meta.visibility ?? 'shared');
      setIsOwner(!!meta.isOwner);
    }).catch(() => {});
    return () => { live = false; };
  }, [chatId, refreshSignal]);

  const labels = useMemo<ChatTicketsLabels>(() => ({
    none: t('none'), spawned: t('spawned'), run: t('run'), lineage: t('lineage'), unlink: t('unlink'),
    pickAgent: t('pickAgent'), lineageTitle: t('lineageTitle'), lineageEmpty: t('lineageEmpty'), merged: t('merged'),
    runNoAgent: t('runNoAgent'), runFailed: t('runFailed'), link: t('link'), agents: t('agents'), merge: t('merge'),
    linkFailed: t('linkFailed'), kindLabel: t('kindLabel'), pickTicket: t('pickTicket'), searchTicket: t('searchTicket'),
    searching: t('searching'), noMatches: t('noMatches'), refine: t('refine'), linkTypeLabel: t('linkTypeLabel'),
    linkTypeLinked: t('linkTypeLinked'), linkTypeCreated: t('linkTypeCreated'), linkAction: t('linkAction'),
    noAgents: t('noAgents'), removeAgent: t('removeAgent'), inviteAgent: t('inviteAgent'), agentsHint: t('agentsHint'),
    people: t('people'), noPeople: t('noPeople'), invitePerson: t('invitePerson'), invitePersonHint: t('invitePersonHint'),
    removePerson: t('removePerson'), inviteSent: t('inviteSent'), invitePending: t('invitePending'),
    visibilityShared: t('visibilityShared'), visibilityLocked: t('visibilityLocked'), lockHint: t('lockHint'),
    mergeHint: t('mergeHint'), mergeNoOthers: t('mergeNoOthers'),
    kind: { task: t('kind.task'), epic: t('kind.epic'), gap: t('kind.gap'), objective: t('kind.objective'), initiative: t('kind.initiative'), portfolio: t('kind.portfolio'), roadmap: t('kind.roadmap'), spec: t('kind.spec') },
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
    listMembers: (id) => brain.listChatMembers(id),
    inviteMember: (id, email) => brain.inviteChatMember(id, email).then((r) => ({ status: r.status })),
    removeMember: (id, memberId) => brain.removeChatMember(id, memberId).then(() => undefined),
    loadAgentPool: () => loadAgentPool().then((ps) => ps.map((p) => ({ ref: p.ref, name: p.name, meta: p.meta, kind: p.kind }))),
    // Server-side typeahead per tier (debounced by the shared LinkForm) — replaces
    // the old "fetch every task/objective/initiative/portfolio/roadmap/spec up front".
    searchTickets: (kind, query, pid) => brain.searchTickets(kind, query, pid),
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
        refreshSignal={refreshSignal}
        visibility={visibility}
        onSetVisibility={isOwner ? async (v) => { await brain.updateChat(chatId, { visibility: v }); setVisibility(v); } : undefined}
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
