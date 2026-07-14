/**
 * Chat titling behavior – useBrainChats (autoTitle, rename, create defaults to placeholder).
 *
 * Tests correspond to PRD Chat Titling requirements:
 * - FR1 (auto-title): placeholder-only replacements on first user turn; single-flight guard; no clobber of user/seeded titles.
 * - FR2 (manual rename): edit interface is rename() hook; best-effort persistence and state update.
 * - FR4 (create defaults): create() calls persistence.createChat with DEFAULT_CHAT_TITLE or user-supplied title.
 *
 * The tests mirror useBrainConversation.test.tsx patterns:
 * - mock persistence to let useBrainChats proceed without real DB
 * - renderHook + waitFor pattern for async operations
 * - act() for sync mutations within a component lifecycle
 * - vi.mocked to safely verify interactions
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useBrainChats, DEFAULT_CHAT_TITLE, deriveChatTitle } from './useBrainChats';
import { resetBrainRunStore } from './brainRunStore';
import { BrainProvider, type BrainConfig, type BrainPersistenceAdapter } from './config';

// --- Mock brain configuration (same pattern as useBrainConversation.test.tsx) ---
let seq = 0;
let persistence: Partial<Record<keyof BrainPersistenceAdapter, unknown>>;
const persistedChats: any[] = [];

const persistenceFake: BrainPersistenceAdapter = {
  listChats: vi.fn(async (params?: { projectId?: string; limit?: number; offset?: number }): Promise<ReturnType<typeof persistedChats>> => persistedChats.slice()),
  getChat: vi.fn(async (id: number) => persistedChats.find((c) => c.id === id)),
  createChat: vi.fn(async (body: { title?: string; projectId?: number | null }): Promise<ReturnType<typeof persistedChats>['0']> => {
    const newChat = {
      id: ++seq,
      title: body.title ?? DEFAULT_CHAT_TITLE,
      projectId: body.projectId ?? null,
      origin: 'firstTurn' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;
    persistedChats.push(newChat);
    return newChat;
  }),
  updateChat: vi.fn(async (id: number, body: { title?: string; projectId?: number | null }): Promise<ReturnType<typeof persistedChats>['0']> => {
    const chat = persistedChats.find((c) => c.id === id);
    expect(chat, `Chat ${id} not found in mock`).toBeTruthy();
    if (!chat) throw new Error(`Chat ${id} not found`);
    if (body?.title) chat.title = body.title;
    if (body?.projectId) chat.projectId = body.projectId;
    chat.updatedAt = new Date().toISOString();
    return { ...chat };
  }),
  deleteChat: vi.fn(async (id: number) => {
    const idx = persistedChats.findIndex((c) => c.id === id);
    if (idx !== -1) persistedChats.splice(idx, 1);
  }),
  summarizeChat: vi.fn(async (id: number): Promise<{ summary: string } | { error: string }> => {
    const chat = persistedChats.find((c) => c.id === id);
    if (!chat) return { error: 'Chat not found' };
    // truncate to ~60 chars to avoid a too-long title (our summarize would be long otherwise)
    const len = 60;
    return { summary: chat.title.slice(0, len) + (chat.title.length > len ? '…' : '') };
  }),
  upload: vi.fn(async () => ({ key: `u${Date.now()}`, name: 'test.txt' })),
  uploadUrl: vi.fn(() => `https://gw.example/u/`),
  sendMessages: vi.fn(async (_c: number, msgs) =>
    msgs.map((m, i) => ({
      id: ++seq,
      role: m.role === 'user' || m.role === 'assistant' ? (m.role === 'user' ? 'user' : 'assistant') : 'user',
      content: m.content,
      metadata: null,
      seq: i,
      createdAt: '',
    })),
  ),
  setMessageFeedback: vi.fn(async () => ({ ok: true, error: undefined })),
} as BrainPersistenceAdapter;

const config: BrainConfig = {
  transport: { baseUrl: 'https://gw.example', getToken: () => null },
  persistence: persistenceFake,
  resolveSystemPrompt: () => 'You are Brain.',
};

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => <BrainProvider config={config}>{children}</BrainProvider>;

beforeEach(() => {
  resetBrainRunStore();
  seq = 0;
  persistedChats.length = 0; // reset mock state
  vi.clearAllMocks();
});

describe('useBrainChats FR1/FR2/FR4: autoTitle and rename behavior', () => {
  const persistChat = (
    title?: string,
    projectId: number | null = null,
    id?: number,
  ): void => {
    seq++;
    persistedChats.push({
      id: id ?? seq,
      title: title ?? DEFAULT_CHAT_TITLE,
      projectId,
      origin: 'firstTurn' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  it('FR4: create generates DEFAULT_CHAT_TITLE placeholder on first chat', async () => {
    persistChat(null) as any; // placeholder chat
    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const chat = await result.current.create();
    expect(result.current.chats[0]?.title).toBe(DEFAULT_CHAT_TITLE);
    expect(persistenceFake.createChat).toHaveBeenCalledWith(
      expect.objectContaining({ title: DEFAULT_CHAT_TITLE, projectId: null }),
    );
  });

  it('FR4: create honors explicit title passed through opts', async () => {
    persistChat(null) as any;
    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const customTitle = 'Pre-defined topic';
    const chat = await result.current.create({ title: customTitle, projectId: 42 });
    expect(result.current.chats[0]?.title).toBe(customTitle);
    expect(persistenceFake.createChat).toHaveBeenCalledWith(
      expect.objectContaining({ title: customTitle, projectId: 42 }),
    );
  });

  it('FR1: autotitle replaces DEFAULT_CHAT_TITLE on first user turn', async () => {
    const newlyCreatedId = 101;
    persistChat(DEFAULT_CHAT_TITLE, null, newlyCreatedId);
    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const firstMsgUserTurn = 'Write script to compress PNGs';
    await act(async () => {
      await result.current.autoTitle(newlyCreatedId, firstMsgUserTurn);
    });

    expect(persistenceFake.updateChat).toHaveBeenCalledTimes(1);
    expect(persistenceFake.updateChat).toHaveBeenCalledWith(
      newlyCreatedId,
      expect.objectContaining({ title: /^Write script to compress PNGs/ }),
    );
  });

  it('FR1: autotitle is single-flight (multiple fires same-turn are idempotent)', async () => {
    const id = 102;
    persistChat(DEFAULT_CHAT_TITLE, null, id);
    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const topic = 'Quick guide for insane developers';

    await act(async () => {
      await result.current.autoTitle(id, topic);
    });
    expect(persistenceFake.updateChat).toHaveBeenCalledTimes(1);
    expect(persistenceFake.updateChat).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ title: /^Quick guide for insane developers/ }),
    );

    await act(async () => {
      await result.current.autoTitle(id, 'Another parallel fire');
    });
    expect(persistenceFake.updateChat).toHaveBeenCalledTimes(1);
  });

  it('FR1: autotitle does NOT clobber existing titles (user or seed-provided)', async () => {
    const id = 103;
    const meaningfulTitle = 'Critical security patch rollout';
    persistChat(meaningfulTitle, null, id);
    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    await act(async () => {
      await result.current.autoTitle(id, 'security patch rollout');
    });
    expect(persistenceFake.updateChat).not.toHaveBeenCalledWith(
      id,
      expect.objectContaining({ title: /^Critical security patch rollout$/ }),
    );
    expect(result.current.chats[0]?.title).toBe(meaningfulTitle);
  });

  it('FR2: rename updates title via updateChat', async () => {
    const id = 104;
    persistChat(DEFAULT_CHAT_TITLE, null, id);
    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const newIndex = 'PSD compression script';

    await act(async () => {
      await result.current.rename(id, newIndex);
    });

    expect(persistenceFake.updateChat).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ title: 'PSD compression script' }),
    );
    expect(result.current.chats[0]?.title).toBe(newIndex);
  });

  it('FR2: rename is best-effort on persistence errors (catch and set error state)', async () => {
    const id = 105;
    persistChat(DEFAULT_CHAT_TITLE, null, id);
    persistenceFake.updateChat.mockRejectedValue(new Error('update failed'));

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const newIndex = 'PSD compression script';

    await act(async () => {
      await expect(result.current.rename(id, newIndex)).resolves.not.toThrow();
    });

    expect(result.current.error).toBe('Rename failed');
  });

  it('deriveChatTitle: checks first line, collapses whitespace, and ellipsis truncation', () => {
    expect(deriveChatTitle('Write script to compress PNGs')).toBe('Write script to compress PNGs');
    expect(deriveChatTitle('   Fix the CRLF edit bug\n\nmore detail \')).toBe('Fix the CRLF edit bug');
    expect(deriveChatTitle('run语文章写不好')).toBe('run语文章写不好');
    expect(deriveChatTitle('first\nline 2\nline 3')).toBe('first'); // multi-line uses first line only
  });

  it('deriveChatTitle: returns empty for blank first line (caller keeps placeholder)', () => {
    expect(deriveChatTitle('')).toBe('');
    expect(deriveChatTitle('   \n\n')).toBe('');
  });

  it('deriveChatTitle: ellipsis after truncation preserves lastSpace guard and trims end', () => {
    const longText = 'Please review the entire brain run store compaction logic and explain why it reverts to the opening request';
    const shortened = deriveChatTitle(longText);
    expect(shortened.length).toBeLessThanOrEqual(60);
    expect(shortened.endsWith('…')).toBe(true);
    expect(shortened).not.toMatch(/\s…$/);
  });
});