// @vitest-environment jsdom
/**
 * The history list's linked-ticket column — the platform rollup (`ticketCount`,
 * `ticketProgressPct`, `ticketOpenCount`, `ticketDoneCount`) the device record does not
 * carry, fed in through `serverChats` and rendered by the shared row's own
 * `ChatTicketStats` column (`bf-chatrow__tickets`). The title stays clean.
 * Pins the states so a regression drops one silently:
 *   - a bound chat with a percent (open/done unknown) shows `67% · 3 tickets`;
 *   - a bound chat with open/done shows `62% · 3 open · 5 done`;
 *   - a chat with tickets but a null pct shows the count only (no misleading `0%`);
 *   - an unsynced chat (no `serverChats` entry) is title-only, no column.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import type { LocalChat } from '../store/records';
import en from '../../_locales/en/messages.json';
import { RovrChatHistory } from './RovrChatHistory';

/** `chrome.*` as the panel reads it: the real English catalog, `$n` substituted positionally. */
beforeEach(() => {
  const catalog = en as unknown as Record<string, { message: string }>;
  vi.stubGlobal('chrome', {
    i18n: {
      getMessage: (key: string, subs: string[] = []) =>
        (catalog[key]?.message ?? '').replace(/\$(\d)/g, (_m, n: string) => subs[Number(n) - 1] ?? ''),
      getUILanguage: () => 'en',
    },
    runtime: { id: 'rovr', onMessage: { addListener: () => undefined, removeListener: () => undefined }, sendMessage: async () => undefined },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A `rows` prop with no handlers — every action is undefined, so the rows render title-only. */
const noActionRows = {
  rowProps: () => ({
    onOpen: () => undefined,
    actionsOpen: false,
    onToggleActions: () => undefined,
  }),
} as never;

const chat = (id: number, title: string, serverId?: number): LocalChat =>
  ({ id, title, serverId, mode: 'chat', createdAt: '', updatedAt: '' }) as unknown as LocalChat;

const serverChat = (
  id: number,
  ticketCount: number,
  ticketProgressPct: number | null,
  counts?: { open: number; done: number },
): BrainChat =>
  ({
    id,
    title: `s${id}`,
    ticketCount,
    ticketProgressPct,
    ...(counts ? { ticketOpenCount: counts.open, ticketDoneCount: counts.done } : {}),
  }) as unknown as BrainChat;

function renderHistory(chats: LocalChat[], serverChats?: ReadonlyMap<number, BrainChat>) {
  return render(
    <RovrChatHistory id="history" chats={chats} loading={false} chatId={null} rows={noActionRows} serverChats={serverChats} />,
  );
}

describe('RovrChatHistory linked-ticket column', () => {
  it('a bound chat with a rollup keeps a clean title and shows the % in the shared ticket column', () => {
    const local = chat(1, 'Ship the onboarding', 501);
    const servers = new Map([[501, serverChat(501, 3, 67)]]);
    const { container } = renderHistory([local], servers);
    const row = container.querySelector('.bf-chatrow');
    expect(row?.textContent).toContain('Ship the onboarding');
    expect(row?.textContent).not.toContain('67% · Ship the onboarding');
    const column = container.querySelector('.bf-chatrow__tickets');
    expect(column?.textContent).toBe('67% · 3 tickets');
    expect(column?.getAttribute('title')).toBe('67% complete across 3 tickets');
    expect(container.querySelector('.bf-chatrow__stats')).toBeNull();
  });

  it('a bound chat with open/done counts shows them in the ticket column', () => {
    const local = chat(4, 'Billing rewrite', 504);
    const servers = new Map([[504, serverChat(504, 8, 62, { open: 3, done: 5 })]]);
    const { container } = renderHistory([local], servers);
    const column = container.querySelector('.bf-chatrow__tickets');
    expect(column?.textContent).toBe('62% · 3 open · 5 done');
    expect(column?.getAttribute('title')).toBe('62% complete: 3 open and 5 done tickets');
  });

  it('a chat with tickets but a null pct shows the count only (no misleading 0%)', () => {
    const local = chat(2, 'Untriaged chat', 502);
    const servers = new Map([[502, serverChat(502, 2, null)]]);
    const { container } = renderHistory([local], servers);
    const row = container.querySelector('.bf-chatrow');
    expect(row?.textContent).toContain('Untriaged chat');
    expect(row?.textContent).not.toContain('0%');
    expect(container.querySelector('.bf-chatrow__tickets')?.textContent).toBe('2 tickets');
  });

  it('a chat with no linked tickets reads "No tickets"', () => {
    const local = chat(5, 'Quiet chat', 505);
    const servers = new Map([[505, serverChat(505, 0, null)]]);
    const { container } = renderHistory([local], servers);
    expect(container.querySelector('.bf-chatrow__tickets')?.textContent).toBe('No tickets');
  });

  it('an unsynced chat with no serverChats entry is unchanged, title-only', () => {
    const local = chat(3, 'Local-only chat');
    const { container } = renderHistory([local], new Map());
    const row = container.querySelector('.bf-chatrow');
    expect(row?.textContent).toContain('Local-only chat');
    expect(row?.textContent).not.toContain('%');
    expect(container.querySelector('.bf-chatrow__tickets')).toBeNull();
  });
});
