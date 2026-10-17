import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ChatHistoryList, ChatHistoryRow, type ChatHistoryLabels } from '@seanhogg/builderforce-brain-ui';
import { AttentionDot } from '@/components/AttentionDot';
import { UnreadBadge } from '@/components/UnreadBadge';
import { ThemeSelect } from '@/components/ThemeSelect';
import { useFormat } from '@/i18n/useFormat';
import { useBrainPanel } from './BrainPanelContext';
import { formatTime } from './brainPanelUtils';

/**
 * The panel's binding of the shared chat history (page sidebar / docked history tab):
 * maps the panel's chats onto `ChatHistoryRow`s and fills the web-only parts — the
 * meta line (project tag, time, attention, unread) and the "Add to project" action.
 */
export function BrainChatList() {
  const { chats, filteredChats, rows, attn, pinnedProjectId, projects, projectName, newProject } = useBrainPanel();
  const fmt = useFormat();
  const tBrain = useTranslations('brain');
  const tCommon = useTranslations('common');
  const labels = useMemo<ChatHistoryLabels>(() => ({
    loading: tCommon('loading'),
    empty: tBrain('noChatsYet'),
    noMatch: tBrain('noChatsMatch'),
    actions: tBrain('chatActions'),
    // The shared row fills `{title}` itself.
    actionsAria: tBrain('chatActionsAria', { title: '{title}' }),
    rename: tBrain('rename'),
    summarize: tBrain('summarize'),
    delete: tCommon('delete'),
  }), [tBrain, tCommon]);
  const projectOptions = useMemo(() => [
    { value: '', label: tBrain('addToProject') },
    { value: '__new__', label: tBrain('createNewProject') },
    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
  ], [projects, tBrain]);

  return (
    <ChatHistoryList loading={chats.loading} total={chats.chats.length} labels={labels}>
      {filteredChats.map((chat) => {
        const active = chats.activeChatId === chat.id;
        const renaming = rows.renamingId === chat.id;
        return (
          <ChatHistoryRow
            key={chat.id}
            chat={chat}
            active={active}
            labels={labels}
            onOpen={rows.openChat}
            actionsOpen={rows.actionsChatId === chat.id}
            onToggleActions={rows.toggleActions}
            renaming={renaming}
            renameValue={renaming ? rows.renameValue : ''}
            onStartRename={rows.startRename}
            onRenameChange={rows.setRenameValue}
            onSubmitRename={rows.submitRename}
            onCancelRename={rows.cancelRename}
            onSummarize={rows.onSummarize}
            summarizing={rows.summarizingId === chat.id}
            onDelete={rows.onDelete}
            deleting={rows.deletingId === chat.id}
            meta={(
              <>
                {chat.projectId != null && pinnedProjectId == null && (
                  <span style={{ background: 'var(--bg-elevated)', padding: '1px 4px', borderRadius: 'var(--radius-sm)' }}>{projectName(chat.projectId)}</span>
                )}
                {formatTime(fmt, chat.updatedAt)}
                <AttentionDot state={attn.chats[chat.id]?.state} />
                {/* The OPEN chat is read, so it never shows an unread badge. */}
                <UnreadBadge count={active ? 0 : attn.chatUnread[chat.id]} />
              </>
            )}
            extraActions={chat.projectId == null && pinnedProjectId == null ? (
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {tBrain('addTo')}
                <ThemeSelect
                  ariaLabel={tBrain('addChatToProjectAria')}
                  value=""
                  onChange={(val) => { if (val === '__new__') newProject.openNewProject(); else if (val !== '') void rows.onAssign(chat.id, Number(val)); }}
                  options={projectOptions}
                  style={{ minWidth: 120, padding: '2px 6px', fontSize: 'var(--font-size-eyebrow)' }}
                />
                {rows.busyId === chat.id && <span style={{ color: 'var(--text-muted)' }}>…</span>}
              </label>
            ) : undefined}
          />
        );
      })}
    </ChatHistoryList>
  );
}
