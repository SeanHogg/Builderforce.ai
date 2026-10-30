import { describe, expect, it, vi } from 'vitest';
import { joinRestorableTurns, restoreTurn } from './restoreTurn';

const notes = { key: 'n1', name: 'notes.txt', type: 'text/plain' };
const more = { key: 'n2', name: 'more.txt', type: 'text/plain' };
const dev = { kind: 'agent', ref: 'dev', label: 'dev' } as never;

describe('joinRestorableTurns - several turns that cannot go come back as ONE', () => {
  it('joins the texts in the order they were said, gathers every file, and keeps the first addressee', () => {
    expect(joinRestorableTurns([
      { text: 'one', recipient: null, attachments: [notes] },
      { text: '@dev two', recipient: dev, attachments: [more] },
      { text: 'three', recipient: null },
    ])).toEqual({ text: 'one\n\n@dev two\n\nthree', attachments: [notes, more], recipient: dev });
  });

  it('is the turn itself when there is one', () => {
    const only = { text: 'alone', recipient: null };
    expect(joinRestorableTurns([only])).toBe(only);
  });

  it('given to restoreTurn ONCE, every text reaches the box - restoring them one by one kept only the first', () => {
    let box = '';
    const composer = {
      draft: () => box,
      setInput: (text: string) => { box = box || text; },
      restoreAttachments: vi.fn(),
      chooseRecipient: vi.fn(),
    };

    restoreTurn(joinRestorableTurns([{ text: 'one', recipient: null }, { text: 'two', recipient: null }, { text: 'three', recipient: null }]), composer);

    expect(box).toBe('one\n\ntwo\n\nthree');
  });
});
