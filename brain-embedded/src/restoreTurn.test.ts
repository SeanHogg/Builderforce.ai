import { describe, expect, it, vi } from 'vitest';
import { joinRestorableTurns, restoreTurn } from './restoreTurn';

const dev = { kind: 'agent', ref: 'dev', label: 'dev' } as never;
const file = { key: 'k', name: 'a.txt', type: 'text/plain' };

function composer(draft: string) {
  return { draft: () => draft, setInput: vi.fn<(next: (current: string) => string) => void>(), restoreAttachments: vi.fn(), chooseRecipient: vi.fn() };
}

/** What the box holds after the (single) write, if the box held `current` when it landed - the write is an updater. */
function boxAfter(c: ReturnType<typeof composer>, current: string): string {
  expect(c.setInput).toHaveBeenCalledTimes(1);
  return c.setInput.mock.calls[0]![0](current);
}

describe('restoreTurn - THE one rule for a turn that could not go', () => {
  it('puts the text, the files AND the addressee back into an empty box', () => {
    const c = composer('');
    restoreTurn({ text: '@dev look', attachments: [file], recipient: dev }, c);
    expect(boxAfter(c, '')).toBe('@dev look');
    expect(c.restoreAttachments).toHaveBeenCalledWith([file]);
    expect(c.chooseRecipient).toHaveBeenCalledWith(dev);
  });

  it('resets the addressee for a turn that had none (a Brain turn never comes back pointed at a participant)', () => {
    const c = composer('');
    restoreTurn({ text: 'plain', recipient: null }, c);
    expect(c.chooseRecipient).toHaveBeenCalledWith(null);
  });

  it('a NEWER draft keeps its addressee and its words - the older turn goes IN FRONT of them, nothing is dropped, the files come back', () => {
    const c = composer('something newer');
    restoreTurn({ text: 'older', attachments: [file], recipient: dev }, c);
    expect(boxAfter(c, 'something newer')).toBe('older\n\nsomething newer');
    expect(c.chooseRecipient).not.toHaveBeenCalled();
    expect(c.restoreAttachments).toHaveBeenCalledWith([file]);
  });

  it('a joined turn (several restored at once) lands in front of a newer draft in the order it was said', () => {
    const c = composer('typed meanwhile');
    restoreTurn(joinRestorableTurns([{ text: 'A', recipient: null }, { text: 'B', recipient: null }, { text: 'C', recipient: null }]), c);
    expect(boxAfter(c, 'typed meanwhile')).toBe('A\n\nB\n\nC\n\ntyped meanwhile');
  });

  it('is computed against the box when the write LANDS: a clear after the read gets the turn alone, typing after it gets the turn in front', () => {
    const cleared = composer('typed');
    restoreTurn({ text: 'older', recipient: null }, cleared);
    expect(boxAfter(cleared, '')).toBe('older');

    const typed = composer('');
    restoreTurn({ text: 'older', recipient: null }, typed);
    expect(boxAfter(typed, 'typed since')).toBe('older\n\ntyped since');
  });

  it('a files-only turn (no words) leaves a newer draft untouched', () => {
    const c = composer('newer');
    restoreTurn({ text: '  ', attachments: [file], recipient: null }, c);
    expect(c.setInput).not.toHaveBeenCalled();
    expect(c.restoreAttachments).toHaveBeenCalledWith([file]);
  });
});
