import { useTranslations } from 'next-intl';
import { useBrainPanel } from './BrainPanelContext';
import { BrainChatRow } from './BrainChatRow';

/** The chat-history rows (page sidebar / docked history tab), with loading + empty states. */
export function BrainChatList() {
  const { chats, filteredChats, rows, attn, isPage, pinnedProjectId, projects, projectName, newProject } = useBrainPanel();
  const tBrain = useTranslations('brain');
  const tCommon = useTranslations('common');
  return (
    <>
      {chats.loading && <div style={{ padding: 12, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{tCommon('loading')}</div>}
      {!chats.loading && filteredChats.length === 0 && (
        <div style={{ padding: 12, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', textAlign: 'center' }}>
          {chats.chats.length === 0 ? tBrain('noChatsYet') : tBrain('noChatsMatch')}
        </div>
      )}
      {filteredChats.map((chat) => {
        const renaming = rows.renamingId === chat.id;
        return (
          <BrainChatRow
            key={chat.id}
            chat={chat}
            isPage={isPage}
            active={chats.activeChatId === chat.id}
            // Row actions are revealed per-row rather than "whatever is selected":
            // docked, opening a chat leaves the history tab, so tying the actions to
            // the selection put rename/delete somewhere the user can no longer see.
            actionsOpen={rows.actionsChatId === chat.id}
            renaming={renaming}
            renameValue={renaming ? rows.renameValue : ''}
            summarizing={rows.summarizingId === chat.id}
            deleting={rows.deletingId === chat.id}
            busy={rows.busyId === chat.id}
            attention={attn.chats[chat.id]?.state}
            unread={attn.chatUnread[chat.id]}
            pinnedProjectId={pinnedProjectId}
            projects={projects}
            projectName={projectName}
            onOpen={rows.openChat}
            onToggleActions={rows.toggleActions}
            onStartRename={rows.startRename}
            onRenameChange={rows.setRenameValue}
            onSubmitRename={rows.submitRename}
            onCancelRename={rows.cancelRename}
            onSummarize={rows.onSummarize}
            onDelete={rows.onDelete}
            onAssign={rows.onAssign}
            onNewProject={newProject.openNewProject}
          />
        );
      })}
    </>
  );
}
