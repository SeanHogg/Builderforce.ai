/**
 * The side panel shell: header (brand, where the next turn runs, what is waiting to
 * sync, the History and New chat levers), five views and the services they share.
 * Whether chat history is showing lives here — the header's lever and the Chat view
 * both read it. Built for a panel from ~320px wide,
 * keyboard-first (the view switcher is a real tablist with arrow-key movement).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InlineChatTitle, SurfaceHeader, SurfaceTabs, useChatRowActions, type SurfaceHeaderHistory } from '@seanhogg/builderforce-brain-ui';
import { createPanelServices, type PanelServices } from '../host/panelServices';
import { t, type MessageKey } from '../i18n/t';
import { liveChats, type LocalChat } from '../store/records';
import { ActionsView } from './ActionsView';
import { ChatView } from './ChatView';
import { RovrChatHistory } from './RovrChatHistory';
import { ServicesContext, useLoaded, useOnline, useServices, useSignedIn, useSyncStats } from './hooks';
import { PlaybooksView } from './PlaybooksView';
import { SettingsView } from './SettingsView';
import { TasksView } from './TasksView';

type View = 'chat' | 'tasks' | 'actions' | 'playbooks' | 'settings';
const VIEWS: ReadonlyArray<{ id: View; label: MessageKey }> = [
  { id: 'chat', label: 'tabChat' },
  { id: 'tasks', label: 'tabTasks' },
  { id: 'actions', label: 'tabActions' },
  { id: 'playbooks', label: 'tabPlaybooks' },
  { id: 'settings', label: 'tabSettings' },
];

const HISTORY_ID = 'rovr-history';

export function App() {
  const [services, setServices] = useState<PanelServices | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    createPanelServices().then(setServices, () => setFailed(true));
  }, []);
  if (failed) return <p className="rovr-empty" role="alert">{t('startFailed')}</p>;
  if (!services) return <p className="rovr-empty">{t('loading')}</p>;
  return (
    <ServicesContext.Provider value={services}>
      <Shell />
    </ServicesContext.Provider>
  );
}

function Shell() {
  const services = useServices();
  const [view, setView] = useState<View>('chat');
  const [chatId, setChatId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chats, reloadChats, chatsLoaded] = useLoaded<LocalChat[]>(() => services.records.listChats(), [], []);
  // ARCHIVED chats are dropped here, at the ONE list every view reads — the history
  // rows, and the header's "open on the most recent chat". The device record store has
  // no `archived=exclude` filter (the server list has), so without this an archived
  // row stays in the panel and Archive would look like it did nothing. The flag stays
  // on the record, so the chat is never re-offered and its transcript survives.
  const live = useMemo(() => liveChats(chats), [chats]);

  // Open on the most recent chat — once, when the panel first has its list. After that
  // `null` is a deliberate state: the new, not-yet-created chat the header's New chat
  // opens, exactly as on every other AI surface.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || live.length === 0) return;
    opened.current = true;
    if (chatId === null) setChatId(live[0]!.id);
  }, [live, chatId]);

  const newChat = useCallback(async () => {
    const chat = await services.records.createChat(t('newChatTitle'));
    reloadChats();
    setChatId(chat.id);
    setView('chat');
    setHistoryOpen(false);
    return chat.id;
  }, [services, reloadChats]);

  // The header's New chat: the empty state, and the first message creates the chat
  // (`ChatView.deliver` → `newChat`) — never a blank record nobody wrote in.
  const startNewChat = useCallback(() => {
    opened.current = true;
    setChatId(null);
    setView('chat');
    setHistoryOpen(false);
  }, []);

  const openChat = useCallback((id: number) => {
    setChatId(id);
    setHistoryOpen(false);
  }, []);
  // THE rename port, shared: the history rows and the header's inline title are the
  // same edit, so they persist through the one path (and reload through the one call).
  const renameChat = useCallback(
    (id: number, title: string) => services.records.updateChat(id, { title }).then(reloadChats, (e: unknown) => services.reportError(e, 'chat.rename')),
    [services, reloadChats],
  );
  // Archive on a device record is a local flag: the row leaves every list, the
  // transcript stays. It goes through `updateChat` — never a delete — so this
  // cannot tombstone a chat whose messages have not synced yet.
  const archiveChat = useCallback(
    (id: number) => services.records.updateChat(id, { isArchived: true }).then(reloadChats, (e: unknown) => services.reportError(e, 'chat.archive')),
    [services, reloadChats],
  );
  // THE shared row state, held here: the history list unmounts whenever it closes.
  const rows = useChatRowActions({
    onOpen: openChat,
    // The device record has no delete or summarize, so the rows offer only Rename
    // and Archive.
    rename: renameChat,
    archive: (chat) => archiveChat(chat.id),
    // Read from the RAW `chats`, not `live`: the gate is what stops an archived
    // row being offered Archive a second time, and `live` has already filtered
    // every archived row out — a predicate over it answers `false` for everything,
    // which is the inert-guard failure this binding exists to prevent.
    isArchived: (id) => Boolean(chats.find((c) => c.id === id)?.isArchived),
  });

  // History belongs to the Chat view: from another view the lever opens it there.
  const showingHistory = historyOpen && view === 'chat';
  const toggleHistory = useCallback(() => {
    setHistoryOpen(view === 'chat' ? !historyOpen : true);
    setView('chat');
  }, [view, historyOpen]);

  return (
    <div className="rovr-shell">
      <Header
        history={{ open: showingHistory, onToggle: toggleHistory, controls: HISTORY_ID }}
        onNewChat={startNewChat}
        chatId={chatId}
        title={(chats.find((c) => c.id === chatId) ?? {}).title || t('newChatTitle')}
        onRename={renameChat}
      />
      {/* THE shared tab strip (roving focus, automatic activation) — one per product. */}
      <SurfaceTabs
        className="rovr-views"
        panelClassName="rovr-view"
        idPrefix="rovr"
        label={t('viewsLabel')}
        activeId={view}
        onSelect={(id) => setView(id as View)}
        tabs={VIEWS.map((v) => ({
          id: v.id,
          label: t(v.label),
          content: v.id === 'chat'
            ? (
              <>
                {showingHistory && (
                  <RovrChatHistory id={HISTORY_ID} chats={live} loading={!chatsLoaded} chatId={chatId} rows={rows} />
                )}
                {/* Kept mounted under the history, so the draft and held turns survive a look. */}
                <div className="rovr-chat-host" hidden={showingHistory}>
                  <ChatView
                    chats={live}
                    chatId={chatId}
                    onNewChat={newChat}
                    onChatsChanged={reloadChats}
                    onOpenSettings={() => setView('settings')}
                  />
                </div>
              </>
            )
            : v.id === 'tasks' ? <TasksView chatId={chatId} onNewChat={newChat} />
              : v.id === 'actions' ? <ActionsView chatId={chatId} />
                : v.id === 'playbooks' ? <PlaybooksView />
                  : <SettingsView />,
        }))}
      />
    </div>
  );
}

function Header({ history, onNewChat, chatId, title, onRename }: {
  history: SurfaceHeaderHistory;
  onNewChat(): void;
  /** THE open chat's id — `null` while a turn has not created the chat yet, so the title is not editable. */
  chatId: number | null;
  title: string;
  onRename: (id: number, title: string) => Promise<unknown> | void;
}) {
  const online = useOnline();
  const signedIn = useSignedIn();
  const stats = useSyncStats();
  const waiting = stats ? stats.queued + stats.inFlight : 0;
  const mode: MessageKey = !online ? 'statusOffline' : signedIn ? 'statusConnected' : 'statusDeviceOnly';
  // THE shared surface header; Rovr's own facts (where the next turn runs, what is
  // waiting to sync) ride in its context slot, behind the open chat's own title.
  return (
    <SurfaceHeader
      title="Rovr"
      history={history}
      onNewChat={onNewChat}
      labels={{ historyShow: t('historyShow'), historyHide: t('historyHide'), newChat: t('newChat') }}
      context={(
        <div className="rovr-status">
          <InlineChatTitle
            title={title}
            chatId={chatId}
            onRename={onRename}
            labels={{
              edit: t('editTitle'),
              label: t('titleLabel'),
              save: t('saveTitle'),
              cancel: t('cancelTitle'),
            }}
          />
          <div aria-live="polite">
            <span className={`bf-chip bf-chip--${online ? (signedIn ? 'ok' : 'local') : 'off'}`}>{t(mode)}</span>
            {waiting > 0 && <span className="bf-chip bf-chip--pending">{t('statusWaiting', waiting)}</span>}
          </div>
        </div>
      )}
    />
  );
}
