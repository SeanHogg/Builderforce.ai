import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { EXPAND_ICON_PATH, HeaderIcon, SurfaceHeader } from '@seanhogg/builderforce-brain-ui';
import { useBrainPanel } from './BrainPanelContext';
import { BrainPanelCaptureButton } from './BrainCaptureButton';
import { BrainChatList } from './BrainChatList';
import { BrainConversation } from './BrainConversation';

/** Docked chrome: the drawer AND a page's own column (Studio / IDE, project details). */
export function BrainDockedLayout() {
  const {
    chats,
    conv,
    dockedTab,
    setDockedTab,
    historyUnread,
    startNewChat,
    pinnedProjectId,
    ctxProjectId,
    onClose,
    headerContext,
    headerActions,
    searchQuery,
    setSearchQuery,
  } = useBrainPanel();
  const tBrain = useTranslations('brain');

  const expandHref = useMemo(() => {
    // Carry the ACTIVE chat (and its project) so the full page opens the SAME
    // conversation; expanding a docked chat used to look like it deleted the chat.
    const qs = new URLSearchParams();
    if (chats.activeChatId != null) qs.set('chat', String(chats.activeChatId));
    const proj = pinnedProjectId ?? ctxProjectId ?? null;
    if (proj != null) qs.set('project', String(proj));
    const q = qs.toString();
    return q ? `/brainstorm?${q}` : '/brainstorm';
  }, [chats.activeChatId, pinnedProjectId, ctxProjectId]);

  const onNewChat = useCallback(() => { setDockedTab('chat'); void startNewChat(); }, [setDockedTab, startNewChat]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>
      {/* No plan chip in the header: the composer below renders it, at the point where
          the allowance is actually spent. */}
      <SurfaceHeader
        title={tBrain('brainTitle')}
        running={conv.sending}
        context={<>{headerContext}</>}
        actions={<><BrainPanelCaptureButton />{headerActions}</>}
        history={{
          open: dockedTab === 'history',
          onToggle: () => setDockedTab(dockedTab === 'history' ? 'chat' : 'history'),
          unread: historyUnread,
          controls: 'brain-history',
        }}
        onNewChat={onNewChat}
        // Expand → the full Brain page on the SAME conversation (the href carries the chat).
        expand={(
          <Link href={expandHref} className="bf-shead__btn" title={tBrain('openFullBrainStorm')} aria-label={tBrain('openFullBrainStorm')}>
            <HeaderIcon d={EXPAND_ICON_PATH} />
          </Link>
        )}
        {...(onClose ? { onClose } : {})}
        labels={{
          historyShow: tBrain('historyShow'),
          historyHide: tBrain('historyHide'),
          newChat: tBrain('newChatAria'),
          close: tBrain('closeBrain'),
        }}
      />
      {dockedTab === 'history' ? (
        <section id="brain-history" aria-label={tBrain('historyShow')} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <div style={{ padding: '8px 12px' }}>
            <input type="search" placeholder={tBrain('searchChats')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '6px 8px', fontSize: 'var(--font-size-small)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </div>
          <BrainChatList />
        </section>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <BrainConversation />
        </div>
      )}
    </div>
  );
}
