import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBrainChatRowActions } from './useBrainChatRowActions';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/ConfirmProvider', () => ({ useConfirm: () => () => Promise.resolve(true) }));

/**
 * WHY this test exists — the one thing a gate test cannot prove on its own:
 *
 * `useChatRowActions` already had a tested "don't offer Archive on an archived row"
 * guard. It stayed INERT anyway, for a long time, because every host passed no
 * `isArchived`, so the predicate was `undefined` and every row read `archived: false`.
 * The unit test on the shared hook kept passing the whole time — it proved the guard
 * works GIVEN the state, and nothing about whether a host ever SUPPLIES that state.
 *
 * So this asserts the binding itself: the panel's `isArchived` reads the chat list the
 * API returned. The list query is `?archived=exclude`, so a live list carries no
 * archived rows — meaning if this predicate ever quietly starts answering `false`
 * for everything again, it is because the field stopped reaching the client (the
 * server projection or the `BrainChat` type regressed), which is exactly the failure
 * that made the guard inert in the first place.
 */
function chatHook(chats: { id: number; isArchived?: boolean }[]) {
  return {
    select: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    summarize: vi.fn(async () => {}),
    archive: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    assignToProject: vi.fn(async () => {}),
    chats,
  } as unknown as Parameters<typeof useBrainChatRowActions>[0]['chats'];
}

function setup(chats: { id: number; isArchived?: boolean }[]) {
  return renderHook(() => useBrainChatRowActions({ chats: chatHook(chats), isPage: true, showChatTab: vi.fn() })).result.current;
}

describe('useBrainChatRowActions — the host actually supplies archive state', () => {
  it('reports a row as archived only when the chat it was read from says so', () => {
    const rows = setup([
      { id: 7, isArchived: false },
      { id: 9, isArchived: true },
    ]);
    expect(rows.rowProps(7).archived).toBe(false);
    expect(rows.rowProps(9).archived).toBe(true);
  });

  it('reads an absent field as not archived, for a server that predates the projection', () => {
    // Optional `isArchived?` in `BrainChat` means an older payload must not throw and
    // must not read as archived — the same convention `memoryEnabled` follows.
    const rows = setup([{ id: 7 }, { id: 8, isArchived: false }]);
    expect(rows.rowProps(7).archived).toBe(false);
    expect(rows.rowProps(8).archived).toBe(false);
  });

  it('re-reads when the list changes, so an archive performed elsewhere is not stale', () => {
    // The predicate closes over `chatList`, so a re-render with a newly archived row
    // has to move it — otherwise this binding passes its first test and still leaves
    // every row `archived: false` in the one case that matters.
    const { result, rerender } = renderHook(
      ({ chats }: { chats: { id: number; isArchived?: boolean }[] }) =>
        useBrainChatRowActions({ chats: chatHook(chats), isPage: true, showChatTab: vi.fn() }),
      { initialProps: { chats: [{ id: 9, isArchived: false }] } },
    );
    expect(result.current.rowProps(9).archived).toBe(false);
    rerender({ chats: [{ id: 9, isArchived: true }] });
    expect(result.current.rowProps(9).archived).toBe(true);
  });

  // The gate above was never the whole binding. `useChatRowActions` renders NO Archive
  // action unless the host hands it an `archive` port, so a host that supplies only
  // `isArchived` reads `archived: false` on every row AND offers no Archive at all.
  // That is exactly the state the web panel was in: the shared hook's own Archive test
  // passed, and the web rows still had nothing to click.
  it('offers Archive and routes it to the chat hook, not to delete', async () => {
    const chats = chatHook([{ id: 7, isArchived: false }]);
    const rows = renderHook(() =>
      useBrainChatRowActions({ chats, isPage: true, showChatTab: vi.fn() }),
    ).result.current;
    expect(rows.rowProps(7).onArchive).toBeTypeOf('function');
    await rows.onArchive!({ id: 7, title: 'Plan' });
    expect(chats.archive).toHaveBeenCalledWith(7);
    expect(chats.remove).not.toHaveBeenCalled();
  });
});