/**
 * The info strip above a synced chat — THE shared `ChatTicketsPanel` the web and the
 * editor show (linked tickets and their health, agents, people, merge, questions) with
 * its spend pill. Only for a chat the platform has (a `serverId`) and a signed-in panel:
 * a device-only chat has no tickets or spend to show.
 *
 * Spend is the `spend` the api attaches to `GET /api/brain/chats/:id` — read when the
 * chat opens and again when a run settles, never polled.
 */
import { useMemo, useRef } from 'react';
import { ChatTicketsPanel, createChatTicketsRestAdapter, type ChatOptionVM } from '@seanhogg/builderforce-brain-ui';
import { useRunRefreshTick, type BrainChat, type BrainRunSnapshot } from '@seanhogg/builderforce-brain-embedded';
import { portRequest } from '../api/requestPorts';
import type { LocalChat } from '../store/records';
import { useLoaded, useServices } from './hooks';
import { rovrChatTicketsLabels } from './labels/chatTicketsLabels';
import { rovrSpendLabels } from './labels/statusLabels';

export interface ChatInfoStripProps {
  serverId: number;
  projectId: number | null;
  chats: LocalChat[];
  run: Pick<BrainRunSnapshot, 'running' | 'messagesEpoch'>;
  onChanged(): void;
}

export function ChatInfoStrip({ serverId, projectId, chats, run, onChanged }: ChatInfoStripProps) {
  const services = useServices();
  const adapter = useMemo(() => createChatTicketsRestAdapter({ request: portRequest(services.api) }), [services]);
  const labels = useMemo(rovrChatTicketsLabels, []);
  const spendLabels = useMemo(rovrSpendLabels, []);
  const locale = useMemo(() => chrome.i18n.getUILanguage(), []);
  const chatList = useMemo<ChatOptionVM[]>(
    () => chats.flatMap((c) => (c.serverId && c.serverId !== serverId ? [{ id: c.serverId, title: c.title }] : [])),
    [chats, serverId],
  );
  // The epoch of the last SETTLED run: unchanged while a run streams, bumped once when
  // it ends — the ticket rail re-reads on open and after each run.
  const settledEpoch = useRef(run.messagesEpoch);
  if (!run.running) settledEpoch.current = run.messagesEpoch;
  const settled = settledEpoch.current;
  // The chat row (its spend) follows the shared run beat: re-read as a run goes and once
  // when it settles, so the spend pill climbs during a long run.
  const refreshTick = useRunRefreshTick(run.running);
  const [chat] = useLoaded<BrainChat | null>(
    () => services.api.request<BrainChat>(`/api/brain/chats/${serverId}`).catch(() => null),
    null,
    [serverId, refreshTick],
  );

  return (
    <div className="rovr-chat__strip">
      <ChatTicketsPanel
        chatId={serverId}
        projectId={projectId}
        chatList={chatList}
        adapter={adapter}
        labels={labels}
        onChanged={onChanged}
        refreshSignal={settled}
        spend={chat?.spend ?? null}
        spendLabels={spendLabels}
        locale={locale}
      />
    </div>
  );
}
