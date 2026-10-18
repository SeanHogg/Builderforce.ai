import { describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useChatRowActions, type ChatRowActions, type UseChatRowActionsOptions } from './useChatRowActions';

/**
 * THE row state every host's chat history binds through: a rename writes once and only
 * when the title changed, a delete waits for the host's confirm, and rows offer only the
 * actions the host supplied.
 */
function setup(overrides: Partial<UseChatRowActionsOptions> = {}) {
  const options: UseChatRowActionsOptions = { onOpen: vi.fn(), rename: vi.fn(async () => {}), ...overrides };
  const current: { value: ChatRowActions | null } = { value: null };
  function Probe() {
    current.value = useChatRowActions(options);
    return null;
  }
  const el = document.createElement('div');
  let root: Root;
  act(() => { root = createRoot(el); root.render(<Probe />); });
  return { rows: () => current.value!, options };
}

const chat = { id: 7, title: 'Plan' };

describe('useChatRowActions', () => {
  it('commits a rename once even when the input blurs after Enter', async () => {
    const { rows, options } = setup();
    act(() => { rows().startRename(chat); });
    expect(rows().rowProps(7).renaming).toBe(true);
    await act(async () => {
      await rows().submitRename(7, 'Roadmap');
      await rows().submitRename(7, 'Roadmap');
    });
    expect(options.rename).toHaveBeenCalledTimes(1);
    expect(options.rename).toHaveBeenCalledWith(7, 'Roadmap');
    expect(rows().renamingId).toBeNull();
  });

  it('treats a blank or unchanged title as a cancel', async () => {
    const { rows, options } = setup();
    act(() => { rows().startRename(chat); });
    await act(async () => { await rows().submitRename(7, '  Plan '); });
    act(() => { rows().startRename(chat); });
    await act(async () => { await rows().submitRename(7, '   '); });
    expect(options.rename).not.toHaveBeenCalled();
  });

  it('deletes only after the host confirms', async () => {
    const remove = vi.fn(async () => {});
    const confirmDelete = vi.fn(async () => false);
    const { rows } = setup({ remove, confirmDelete });
    await act(async () => { await rows().onDelete(chat); });
    expect(confirmDelete).toHaveBeenCalledWith(chat);
    expect(remove).not.toHaveBeenCalled();
    confirmDelete.mockResolvedValueOnce(true);
    await act(async () => { await rows().onDelete(chat); });
    expect(remove).toHaveBeenCalledWith(chat);
  });

  it('offers Summarize / Archive / Delete only when the host supplies them', () => {
    expect(setup().rows().rowProps(1).onDelete).toBeUndefined();
    expect(setup().rows().rowProps(1).onSummarize).toBeUndefined();
    expect(setup().rows().rowProps(1).onArchive).toBeUndefined();
    const { rows } = setup({ summarize: vi.fn(), archive: vi.fn(), remove: vi.fn() });
    expect(rows().rowProps(1).onDelete).toBeTypeOf('function');
    expect(rows().rowProps(1).onSummarize).toBeTypeOf('function');
    expect(rows().rowProps(1).onArchive).toBeTypeOf('function');
  });

  // Archive takes NO confirm: it is a change of view, not a destroy. It is also the
  // one action that must not double up on itself — archiving an archived row is a
  // no-op the menu cannot even reach.
  it('archives without a confirm and never re-offers Archive on an archived row', async () => {
    const archive = vi.fn(async () => {});
    const isArchived = (id: number) => id === 9;
    const { rows } = setup({ archive, isArchived });
    await act(async () => { await rows().onArchive(chat); });
    expect(archive).toHaveBeenCalledWith(chat);
    expect(rows().rowProps(9).archived).toBe(true);
    expect(rows().rowProps(9).onArchive).toBeUndefined();
    expect(rows().rowProps(7).archived).toBe(false);
  });

  it('reveals the opened row only for a host that keeps the list beside the thread', () => {
    const { rows, options } = setup({ revealActionsOnOpen: true });
    act(() => { rows().openChat(3); });
    expect(options.onOpen).toHaveBeenCalledWith(3);
    expect(rows().rowProps(3).actionsOpen).toBe(true);
  });
});
