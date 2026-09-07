'use client';

/**
 * ChatTicketsPanel (web) — a thin host wrapper around the SHARED
 * `@seanhogg/builderforce-brain-ui` ChatTicketsPanel. All the UI AND the REST
 * adapter live in the shared package (both rendered identically in the VS Code
 * webview); here we only:
 *   1. mount `createChatTicketsRestAdapter` on the web's authenticated request
 *      function, supplying the one thing the package cannot know — whether this
 *      viewer's tenant role permits dispatching a run,
 *   2. map the next-intl `brain.tickets` catalog into the shared labels bundle, and
 *   3. own the web-only chrome: routing a clicked ticket, and the owner's lock toggle.
 *
 * The adapter used to be built here by hand and again in the VS Code webview.
 * See `chatTickets/restAdapter.ts` for what the two copies had already lost.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ChatTicketsPanel as SharedChatTicketsPanel,
  createChatTicketsRestAdapter,
  type ChatTicketsAdapter, type ChatTicketsLabels, type TicketLinkVM,
} from '@seanhogg/builderforce-brain-ui';
import { artifactRoutePath } from '@seanhogg/builderforce-brain-embedded';
import { brain, type BrainChat } from '@/lib/builderforceApi';
import { apiRequest } from '@/lib/apiClient';
import { onBrainDataChanged } from '@/lib/brain/brainDataEvent';
import { usePermission } from '@/lib/rbac';

export function ChatTicketsPanel({ chatId, projectId, chatList, onChanged }: {
  chatId: number;
  projectId: number | null;
  chatList: Array<Pick<BrainChat, 'id' | 'title'>>;
  onChanged?: () => void;
}) {
  const t = useTranslations('brain.tickets');
  const tc = useTranslations('common');
  const router = useRouter();
  // "Tag to execute" DISPATCHES a run, so it needs the same DEVELOPER+ gate as
  // every other run control. The button lives in the shared surface-agnostic
  // @seanhogg/builderforce-brain-ui package (it also renders in the VS Code
  // webview, which has no tenant-role context), so it can't be wrapped in
  // <RoleGate> from here. Instead the package asks the HOST via the adapter's
  // `canRunTicket` probe below, which disables and explains the control exactly
  // like every other gated affordance — rather than the click-time refusal this
  // used to be. Nothing is hidden.
  const { allowed: canDispatchRun } = usePermission('runtime.execute');

  // Open a linked work item in its own view. WHERE each kind opens is the shared
  // `artifactRoutePath` table (brain-embedded) — the same one the VS Code host uses
  // for its external-URL open, so "Open" cannot mean two different destinations on
  // two surfaces. Every kind lands on the ITEM (the ticket's detail drawer, the
  // focused OKR card, the spec's document drawer, the roadmap row's panel), not
  // merely on the page that contains it.
  const openTicket = useMemo(() => (tk: TicketLinkVM) => {
    router.push(artifactRoutePath(tk.kind, tk.ref, projectId));
  }, [router, projectId]);

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
    none: t('none'), spawned: t('spawned'), run: t('run'), open: t('open'), lineage: t('lineage'), unlink: t('unlink'),
    pickAgent: t('pickAgent'), lineageTitle: t('lineageTitle'), lineageEmpty: t('lineageEmpty'), merged: t('merged'),
    runNoAgent: t('runNoAgent'), runFailed: t('runFailed'), link: t('link'), agents: t('agents'), merge: t('merge'),
    questions: t('questions'), noQuestions: t('noQuestions'), answerPlaceholder: t('answerPlaceholder'),
    submitAnswer: t('submitAnswer'), answering: t('answering'),
    linkFailed: t('linkFailed'), kindLabel: t('kindLabel'), pickTicket: t('pickTicket'), searchTicket: t('searchTicket'),
    searching: t('searching'), noMatches: t('noMatches'), refine: t('refine'), linkTypeLabel: t('linkTypeLabel'),
    linkTypeLinked: t('linkTypeLinked'), linkTypeCreated: t('linkTypeCreated'), linkAction: t('linkAction'),
    noAgents: t('noAgents'), removeAgent: t('removeAgent'), inviteAgent: t('inviteAgent'), agentsHint: t('agentsHint'),
    people: t('people'), noPeople: t('noPeople'), invitePerson: t('invitePerson'), invitePersonHint: t('invitePersonHint'),
    removePerson: t('removePerson'), inviteSent: t('inviteSent'), invitePending: t('invitePending'),
    visibilityShared: t('visibilityShared'), visibilityLocked: t('visibilityLocked'), lockHint: t('lockHint'),
    mergeHint: t('mergeHint'), mergeNoOthers: t('mergeNoOthers'),
    showTickets: t('showTickets'), hideTickets: t('hideTickets'),
    kind: { task: t('kind.task'), epic: t('kind.epic'), gap: t('kind.gap'), objective: t('kind.objective'), initiative: t('kind.initiative'), portfolio: t('kind.portfolio'), roadmap: t('kind.roadmap'), spec: t('kind.spec'), retro: t('kind.retro'), poker: t('kind.poker') },
    ringAria: (label, pct) => t('ringAria', { label, pct }),
    ticketCount: (n) => t('ticketCount', { n }),
    overallAria: (pct) => t('overallAria', { pct }),
    runStarted: (agent) => t('runStarted', { agent }),
    mergeAction: (n) => t('mergeAction', { n }),
    mergedN: (n) => t('mergedN', { n }),
  }), [t]);

  const adapter = useMemo<ChatTicketsAdapter>(() => createChatTicketsRestAdapter({
    request: apiRequest,
    // The shared package can't read a tenant role, so the web host answers the
    // capability probe for it. This is what actually DISABLES the Run affordance;
    // the adapter's own throw stays as the enforcement backstop (a stale render,
    // or a role that changed between paint and click, must still be refused).
    canRun: () => ({ allowed: canDispatchRun, reason: tc('requiresDeveloperRole') }),
  }), [canDispatchRun, tc]);

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
        onOpenTicket={openTicket}
      />
    </div>
  );
}

