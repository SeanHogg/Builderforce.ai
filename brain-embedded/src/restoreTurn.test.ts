import { describe, expect, it, vi } from 'vitest';
import { joinRestorableTurns, restoreTurn } from './restoreTurn';

const dev = { kind: 'agent', ref: 'dev', label: 'dev' } as never;
const file = { key: 'k', name: 'a.txt', type: 'text/plain' };

function composer(draft: string) {
  return { draft: () => draft, setInput: vi.fn(), restoreAttachments: vi.fn(), chooseRecipient: vi.fn() };
}

describe('restoreTurn - THE one rule for a turn that could not go', () => {
  it('puts the text, the files AND the addressee back into an empty box', () => {
    const c = composer('');
    restoreTurn({ text: '@dev look', attachments: [file], recipient: dev }, c);
    expect(c.setInput).toHaveBeenCalledWith('@dev look');
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
    expect(c.setInput).toHaveBeenCalledWith('older\n\nsomething newer');
    expect(c.chooseRecipient).not.toHaveBeenCalled();
    expect(c.restoreAttachments).toHaveBeenCalledWith([file]);
  });

  it('a joined turn (several restored at once) lands in front of a newer draft in the order it was said', () => {
    const c = composer('typed meanwhile');
    restoreTurn(joinRestorableTurns([{ text: 'A', recipient: null }, { text: 'B', recipient: null }, { text: 'C', recipient: null }]), c);
    expect(c.setInput).toHaveBeenCalledTimes(1);
    expect(c.setInput).toHaveBeenCalledWith('A\n\nB\n\nC\n\ntyped meanwhile');
  });

  it('a files-only turn (no words) leaves a newer draft untouched', () => {
    const c = composer('newer');
    restoreTurn({ text: '  ', attachments: [file], recipient: null }, c);
    expect(c.setInput).not.toHaveBeenCalled();
    expect(c.restoreAttachments).toHaveBeenCalledWith([file]);
  });
});
