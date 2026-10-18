import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ChatHistoryList, ChatHistoryRow, chatHistoryLabelsFrom } from '@seanhogg/builderforce-brain-ui';
import { AttentionDot } from '@/components/AttentionDot';
import { UnreadBadge } from '@/components/UnreadBadge';
import { ThemeSelect } from '@/components/ThemeSelect';
import { useFormat } from '@/i18n/useFormat';
import { useLabelLookup } from '@/i18n/useLabelLookup';
import { useBrainPanel } from './BrainPanelContext';
import { formatTime } from './brainPanelUtils';

/** brain-ui's canonical chat-history keys → the web catalog (the row fills `{title}` itself). */
const CHAT_HISTORY_PATH: Readonly<Record<string, string>> = {
  loading: 'common.loading',
  empty: 'brain.noChatsYet',
  noMatch: 'brain.noChatsMatch',
  actions: 'brain.chatActions',
  actionsAria: 'brain.chatActionsAria',
  rename: 'brain.rename',
  summarize: 'brain.summarize',
  delete: 'common.delete',
};
const chatHistoryPath = (key: string): string | undefined => CHAT_HISTORY_PATH[key];

/**
 * The panel's binding of the shared chat history (page sidebar / docked history tab):
 * maps the panel's chats onto `ChatHistoryRow`s and fills the web-only parts — the
 * meta line (project tag, time, attention, unread) and the "Add to project" action.
 */
export function BrainChatList() {
  const { chats, filteredChats, rows, attn, pinnedProjectId, projects, projectName, newProject } = useBrainPanel();
  const fmt = useFormat();
  const tBrain = useTranslations('brain');
  const lookup = useLabelLookup(chatHistoryPath);
  const labels = useMemo(() => chatHistoryLabelsFrom(lookup), [lookup]);
  const projectOptions = useMemo(() => [
    { value: '', label: tBrain('addToProject') },
    { value: '__new__', label: tBrain('createNewProject') },
    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
  ], [projects, tBrain]);

  return (
    <ChatHistoryList loading={chats.loading} total={chats.chats.length} labels={labels}>
      {filteredChats.map((chat) => {
        const active = chats.activeChatId === chat.id;
        return (
          <ChatHistoryRow
            key={chat.id}
            chat={chat}
            active={active}
            labels={labels}
            {...rows.rowProps(chat.id)}
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
