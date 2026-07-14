/**
 * The chat-titling behavior ships as platform functionality in the Brain hook:
 * - auto-title only replaces the placeholder FIRST a user sends a turn
 * - auto-title guards against doing this multiple times (single-flight)
 * - auto-title NEVER overwrites a user-provided or seed-titled chat
 * - rename persists a custom label immediately
 * - create always creates-chats with a default title (placeholder/no intent-case)
 *
 * This test file is the TESTS persona coverage for FR1 (auto-title) and FR2
 * (manual edit) plus FR4 (create defaults to placeholder), ordered by AC:
 * AC-1: Newly initiated chat title defaults to "New chat" on create.
 * AC-2: First-user-turn auto-title replaces "New chat" with a topic-based title.
 * AC-3: Auto-title respects single-flight (full same-turn guard) and fails gracefully.
 * AC-4: Auto-title does NOT rename chats whose title is already set (user or seed).
 * AC-5: Manual rename updates the title and persists via updateChat.
 * AC-6: Rename is best-effort (fails to persist only on updateChat error).
 * AC-7: Title editing maximum-of-100 vs auto-title truncation is not enforced here;
 *       that would need a UI hook integ test (not in scope of this unit test suite).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useBrainChats, DEFAULT_CHAT_TITLE, deriveChatTitle } from './useBrainChats';
import { resetBrainRunStore } from './brainRunStore';
import {
  type BrainPersistenceAdapter,
  type BrainConfig,
  BrainProvider,
  type BrainChat,
} from './config';

// --- Persistence mock that stays consistent across the suite ---
let chatSeq = 0;
let persistence: Partial<Record<keyof BrainPersistenceAdapter, any>>;
const persistedChats: ChatMock[] = [];

function resetPersistence() {
  persistedChats.length = 0;
  chatSeq = 0;
  persistence = {
    listChats: vi.fn(async (params) => persistedChats.slice(),
      // Limits (if implemented) are ignored for simplicity
    ),
    getChat: vi.fn(async (id: number) => persistedChats.find((c) => c.id === id)),
    createChat: vi.fn(async (body: { title?: string; projectId?: number | null }) => {
      const chatId = ++chatSeq;
      const newChat: ChatMock = {
        id: chatId,
        title: body.title ?? DEFAULT_CHAT_TITLE, // FR4: create defaults to placeholder
        projectId: body.projectId ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      persistedChats.push(newChat);
      return newChat;
    }),
    updateChat: vi.fn(async (id: number, body: { title?: string; projectId?: number | null }) => {
      const chat = persistedChats.find((c) => c.id === id);
      if (!chat) return { ...chat }; // Return a fresh object to prove it changed
      // Apply partial update (title and/or projectId) per BrainPersistenceAdapter signature
      if (body.title !== undefined) {
        chat.title = body.title;
      }
      if (body.projectId !== undefined) {
        chat.projectId = body.projectId;
      }
      chat.updatedAt = new Date().toISOString();
      return {
        ...chat,
      };
    }),
    deleteChat: vi.fn(async (id: number) => {
      const idx = persistedChats.findIndex((c) => c.id === id);
      if (idx !== -1) persistedChats.splice(idx, 1);
    }),
    summarizeChat: vi.fn(async (id: number): Promise<{ summary: string } | { error: string }> => {
      const chat = persistedChats.find((c) => c.id === id);
      if (!chat) return { error: 'Chat not found' };
      return { summary: truncateChat(chat.title, 40) };
    }),
    // Remaining required methods are unused in autoTitle/rename create; we keep stubs for completeness.
    upload: vi.fn(async () => ({ key: `u${Date.now()}`, name: 'test.txt' })),
    uploadUrl: vi.fn((_key: string) => `https://gw.example/u/${_key}`),
    sendMessages: vi.fn(async (_c: number, msgs) =>
      msgs.map((m, i) => ({ id: ++chatSeq, role: m.role as 'user' | 'assistant', content: m.content, metadata: null, seq: i, createdAt: '' })),
    ),
    setMessageFeedback: vi.fn() as any,
  } as Partial<BrainPersistenceAdapter>;
}

/** Minified version for summarizeChat mock (helps avoid false-positive autoTitle in its summary tests). */
function truncateChat(title: string, len: number): string {
  // Keep 3-10 words: keep first word + ellipsis if long
  const first = title.trim().split(/\s+/)[0] || DEFAULT_CHAT_TITLE;
  return first.slice(0, len) + (first.length > len ? '…' : '');
}

const config: BrainConfig = {
  transport: { baseUrl: 'https://gw.example', getToken: () => null },
  persistence: {} as BrainPersistenceAdapter,
  resolveSystemPrompt: () => 'You are Brain.',
};

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <BrainProvider config={config}>{children}</BrainProvider>
);

function addChat(title: string, projectId: number | null = null) {
  return {
    title,
    projectId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as ChatMock;
}

interface ChatMock {
  id: number;
  title: string;
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
}

beforeEach(() => {
  resetBrainRunStore();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useBrainChats chat titling (FR1, FR2, FR4)', () => {
  it('AC-1: create defaults to DEFAULT_CHAT_TITLE placeholder', async () => {
    resetPersistence();
    persistChat(null); // chat without projectId

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const chat = await result.current.create();
    expect(persistence.createChat).toHaveBeenCalledWith(
      expect.objectContaining({ title: DEFAULT_CHAT_TITLE, projectId: null }),
    );
    expect(chat.title).toBe(DEFAULT_CHAT_TITLE);
  });

  it('AC-1 variant: create with custom title passes it through', async () => {
    resetPersistence();
    persistChat(null);
    const customTitle = 'Pre-defined topic';

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const chat = await result.current.create({ title: customTitle, projectId: 42 });
    expect(persistence.createChat).toHaveBeenCalledWith(
      expect.objectContaining({ title: customTitle, projectId: 42 }),
    );
    expect(chat.title).toBe(customTitle); // create honors custom label (no guard relative to placeholder)
  });

  it('AC-2: auto-title replaces placeholder with topic from first-h user turn', async () => {
    resetPersistence();
    const newlyCreatedId = 101;
    persistChat({ id: newlyCreatedId, title: DEFAULT_CHAT_TITLE, projectId: null });

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const firstMsgUserTurn = 'Write a script to compress PNGs';
    await act(async () => {
      await result.current.autoTitle(newlyCreatedId, firstMsgUserTurn);
    });

    expect(persistence.updateChat).toHaveBeenCalledWith(
      newlyCreatedId,
      expect.objectContaining({ title: expect.stringMatching(/^Write a script to compress PNGs/) }),
    );
    expect(result.current.chats[0]?.title).not.toBe(DEFAULT_CHAT_TITLE);
  });

  it('AC-3: auto-title respects single-flight guard (call again with parallel fire)', async () => {
    resetPersistence();
    const id = 102;
    persistChat({ id, title: DEFAULT_CHAT_TITLE, projectId: null });

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);
    const derived = 'Quick guide for insane developers';

    // First call updates
    await act(async () => {
      await result.current.autoTitle(id, derived);
    });
    expect(persistence.updateChat).toHaveBeenCalledTimes(1);
    expect(persistence.updateChat).toHaveBeenCalledWith(id, expect.objectContaining({ title: expect.stringMatching(/^Quick guide for insane developers/) }));

    // Second call when same-turn fires again (STRICTMODE/TWIRL API)
    await act(async () => {
      await result.current.autoTitle(id, 'Another parallel fire'); // usage of empty text is fine
    });

    // Should not perform another update (single-flight guard)
    expect(persistence.updateChat).toHaveBeenCalledTimes(1);
    expect(result.current.chats[0]?.title).not.toBe(DEFAULT_CHAT_TITLE);
  });

  it('AC-4: auto-title does NOT overwrite user or seed-provided titles', async () => {
    resetPersistence();
    const seedOrUserTitleId = 103;
    const seedOrUserTitle = 'Critical security patch rollout'; // used by task seeding or by user rename

    persistChat({ id: seedOrUserTitleId, title: seedOrUserTitle, projectId: null });

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const draftedAutoTitle = 'security patch rollout';

    // First fire attempt
    await act(async () => {
      await result.current.autoTitle(seedOrUserTitleId, draftedAutoTitle);
    });

    // Should skip update because chat title already matches seed/user label
    expect(persistence.updateChat).not.toHaveBeenCalledWith(
      seedOrUserTitleId,
      expect.objectContaining({ title: expect.not.stringMatching('^Critical security patch rollout') }),
    );
    expect(result.current.chats[0]?.title).toBe(seedOrUserTitle); // MID: title not changed
  });

  it('AC-4 variant: auto-title also skips when title is already a meaningful label (neither DEFAULT_CHAT_TITLE)', async () => {
    resetPersistence();
    const id = 104;
    const meaningfulTitle = 'Project cleanup thread'; // used by seeding

    persistChat({ id, title: meaningfulTitle, projectId: null });

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    await act(async () => {
      await result.current.autoTitle(id, 'Project cleanup thread'); // the auto-title engine’s alias
    });

    // Should skip update because chat title explicitly came from seeding
    expect(persistence.updateChat).not.toHaveBeenCalledWith(id, expect.objectContaining({ title: expect.not.stringMatching(/^Project cleanup thread$/) }));
    expect(result.current.chats[0]?.title).toBe(meaningfulTitle);
  });

  it('AC-5: rename updates the title and persists via updateChat', async () => {
    resetPersistence();
    const id = 105;
    persistChat({ id, title: DEFAULT_CHAT_TITLE, projectId: null });

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const newIndex = 'Quick guide for insane developers';

    await act(async () => {
      await result.current.rename(id, newIndex);
    });

    expect(persistence.updateChat).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ title: newIndex }),
    );
    expect(result.current.chats[0]?.title).toBe(newIndex);
  });

  it('AC-5 variant: rename best-effort on updateChat failure (raises error)', async () => {
    resetPersistence();
    const id = 106;
    persistChat({ id, title: DEFAULT_CHAT_TITLE, projectId: null });
    // Stub updateChat to reject
    persistence.updateChat = vi.fn<BrainPersistenceAdapter['updateChat'], Promise<BrainChat>>(() => Promise.reject(new Error('update failed')));

    const { result } = renderHook(() => useBrainChats(), { wrapper });
    await waitFor(() => !result.current.loading);

    const newIndex = 'PSD compression script';

    await act(async () => {
      await expect(result.current.rename(id, newIndex)).resolves.not.toThrow();
    });

    // updateChat was invoked, but the error was caught and set as error state (keepEssential vs hideIntermediate)
    expect(result.current.error).toBe('Rename failed'); // best-effort as per autoTitle implementation
  });

  it('Extra test: deriveChatTitle integrity mirrors autoTitle expectations', () => {
    // Acceptance-criteria-aligned case: short first message, trimmed, <= 60
    expect(deriveChatTitle('Write script to compress PNGs')).toBe('Write script to compress PNGs');
    expect(deriveChatTitle('   Fix the CRLF edit bug\n\nmore detail ')).toBe('Fix the CRLF edit bug');
    expect(deriveChatTitle(run语文章写不好的测试示例)).toBe('run语文章写不好');

    // Multi-line guard: only first line used, ignore onto third line
    expect(deriveChatTitle('line 1\nline 2\nline 3')).toBe('line 1');
    expect(deriveChatTitle('line 1\n\nline 2')).toBe('line 1'); // extra whitespace should be collapsed
    expect(deriveChatTitle('line 1\n\n\n')).toBe(''); // whitespace-only first line yields empty

    // Long-line truncation guard: collapse and ellipsis
    const longText = 'Please review the entire brain run store compaction logic and explain why it reverts to the opening request';
    expect(deriveChatTitle(longText).length).toBeLessThanOrEqual(61);
    expect(deriveChatTitle(longText).endsWith('…')).toBe(true);
  });
});

/**
 * Helpers for suite maintainers:
 * - persistChat: Simulates an existing chat in persistence via our ICS.
 * - resetPersistence: Clears state and restores stubs prior to each test.
 */
function persistChat(chatl?: Partial<ChatMock>) {
  if (chatl) {
    chatSeq++;
    const base: ChatMock = {
      id: chatSeq,
      title: chatl.title ?? DEFAULT_CHAT_TITLE,
      projectId: chatl.projectId ?? null,
      createdAt: chatl.createdAt ?? new Date().toISOString(),
      updatedAt: chatl.updatedAt ?? new Date().toISOString(),
    };
    persistedChats.push(base);
  } else {
    chatSeq++; // placeholder chat for create
    persistedChats.push({
      id: chatSeq,
      title: DEFAULT_CHAT_TITLE,
      projectId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}