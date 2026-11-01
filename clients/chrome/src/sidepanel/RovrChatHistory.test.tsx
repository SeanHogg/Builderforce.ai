// @vitest-environment jsdom
/**
 * The history list's linked-ticket progress — the platform rollup (`ticketCount`,
 * `ticketProgressPct`) the device record does not carry, fed in through `serverChats`
 * and surfaced two ways by the shared row:
 *   - the title prefix `67% · ` via the shared `chatSwitcherLabel`;
 *   - the stats pill (`bf-chatrow__stats`) with the same guard as the web/VSIX.
 * Pins the three states so a regression drops one silently:
 *   - a bound chat with a rollup shows BOTH the prefix and the pill;
 *   - a chat with tickets but a null pct shows title-only (no misleading `0%`);
 *   - an unsynced chat (no `serverChats` entry) is unchanged, title-only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { BrainChat } from '@seanhogg/builderforce-brain-embedded';
import type { LocalChat } from '../store/records';
import { RovrChatHistory } from './RovrChatHistory';

/** `chrome.*` as the panel reads it: no catalog (every `t()` is its key), English UI. */
beforeEach(() => {
  vi.stubGlobal('chrome', {
    i18n: { getMessage: () => '', getUILanguage: () => 'en' },
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

const serverChat = (id: number, ticketCount: number, ticketProgressPct: number | null): BrainChat =>
  ({ id, title: `s${id}`, ticketCount, ticketProgressPct }) as unknown as BrainChat;

function renderHistory(chats: LocalChat[], serverChats?: ReadonlyMap<number, BrainChat>) {
  return render(
    <RovrChatHistory id="history" chats={chats} loading={false} chatId={null} rows={noActionRows} serverChats={serverChats} />,
  );
}

describe('RovrChatHistory linked-ticket progress', () => {
  it('a bound chat with a rollup shows the % title prefix and the stats pill', () => {
    const local = chat(1, 'Ship the onboarding', 501);
    const servers = new Map([[501, serverChat(501, 3, 67)]]);
    const { container } = renderHistory([local], servers);
    const row = container.querySelector('.bf-chatrow');
    expect(row?.textContent).toContain('67% · Ship the onboarding');
    const pill = container.querySelector('.bf-chatrow__stats');
    expect(pill?.textContent).toBe('67%');
  });

  it('a chat with tickets but a null pct shows title-only (no misleading 0%)', () => {
    const local = chat(2, 'Untriaged chat', 502);
    const servers = new Map([[502, serverChat(502, 2, null)]]);
    const { container } = renderHistory([local], servers);
    const row = container.querySelector('.bf-chatrow');
    expect(row?.textContent).toContain('Untriaged chat');
    expect(row?.textContent).not.toContain('0% ·');
    expect(container.querySelector('.bf-chatrow__stats')).toBeNull();
  });

  it('an unsynced chat with no serverChats entry is unchanged, title-only', () => {
    const local = chat(3, 'Local-only chat');
    const { container } = renderHistory([local], new Map());
    const row = container.querySelector('.bf-chatrow');
    expect(row?.textContent).toContain('Local-only chat');
    expect(row?.textContent).not.toContain('% ·');
    expect(container.querySelector('.bf-chatrow__stats')).toBeNull();
  });
});
