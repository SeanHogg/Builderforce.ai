import { describe, expect, it, vi } from 'vitest';
import { restoreTurn } from './restoreTurn';

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

  it('a NEWER draft keeps its text and its addressee: only the files come back', () => {
    const c = composer('something newer');
    restoreTurn({ text: 'older', attachments: [file], recipient: dev }, c);
    expect(c.setInput).not.toHaveBeenCalled();
    expect(c.chooseRecipient).not.toHaveBeenCalled();
    expect(c.restoreAttachments).toHaveBeenCalledWith([file]);
  });
});
