/**
 * The side panel shell: header (brand, where the next turn runs, what is waiting to
 * sync), five views and the services they share. Built for a panel from ~320px wide,
 * keyboard-first (the view switcher is a real tablist with arrow-key movement).
 */
import { useCallback, useEffect, useState } from 'react';
import { SurfaceHeader, SurfaceTabs } from '@seanhogg/builderforce-brain-ui';
import { createPanelServices, type PanelServices } from '../host/panelServices';
import { t, type MessageKey } from '../i18n/t';
import type { LocalChat } from '../store/records';
import type { SyncStats } from '../sync/runtimeMessages';
import { ActionsView } from './ActionsView';
import { ChatView } from './ChatView';
import { ServicesContext, useLoaded, useOnline, useServices, useSignedIn } from './hooks';
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
  const [chats, reloadChats] = useLoaded<LocalChat[]>(() => services.records.listChats(), [], []);

  // Open on the most recent chat.
  useEffect(() => {
    if (chatId === null && chats.length > 0) setChatId(chats[0]!.id);
  }, [chats, chatId]);

  const newChat = useCallback(async () => {
    const chat = await services.records.createChat(t('newChatTitle'));
    reloadChats();
    setChatId(chat.id);
    setView('chat');
    return chat.id;
  }, [services, reloadChats]);

  return (
    <div className="rovr-shell">
      <Header />
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
              <ChatView
                chats={chats}
                chatId={chatId}
                onSelect={setChatId}
                onNewChat={newChat}
                onChatsChanged={reloadChats}
                onOpenSettings={() => setView('settings')}
              />
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

function Header() {
  const services = useServices();
  const online = useOnline();
  const signedIn = useSignedIn();
  const [stats, setStats] = useState<SyncStats | null>(null);
  useEffect(() => {
    let live = true;
    const poll = () =>
      services
        .sendRuntime({ type: 'rovr.sync.stats' })
        .then((s) => live && setStats(s as SyncStats))
        .catch(() => undefined);
    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [services]);
  const waiting = stats ? stats.queued + stats.inFlight : 0;
  const mode: MessageKey = !online ? 'statusOffline' : signedIn ? 'statusConnected' : 'statusDeviceOnly';
  // THE shared surface header; Rovr's own facts (where the next turn runs, what is
  // waiting to sync) ride in its context slot.
  return (
    <SurfaceHeader
      title="Rovr"
      context={(
        <div className="rovr-status" aria-live="polite">
          <span className={`rovr-chip rovr-chip--${online ? (signedIn ? 'ok' : 'local') : 'off'}`}>{t(mode)}</span>
          {waiting > 0 && <span className="rovr-chip rovr-chip--pending">{t('statusWaiting', waiting)}</span>}
        </div>
      )}
    />
  );
}
