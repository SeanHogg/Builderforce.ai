import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { blocksToMarkdown, parseMarkdownToBlocks, emptyBlock } from '../domain/blockDocument';
import { createLocalBlockStore, type BlockStore } from '../domain/blockStore';
import { blocksArray, createCrdtBlockStore, seedBlocks } from './crdtBlockStore';

/** Two clients over real `Y.Doc`s, wired to each other the way the room wires them. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== b) Y.applyUpdate(b, update, a); });
  b.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== a) Y.applyUpdate(a, update, b); });
  return { a, b };
}

/**
 * The two implementations are asserted through the SAME suite, because the whole
 * point of the contract is that the editor cannot tell them apart. A behaviour
 * that only the local one has is a behaviour that disappears the moment somebody
 * joins.
 */
describe.each([
  ['local', (blocks: ReturnType<typeof parseMarkdownToBlocks>) => createLocalBlockStore(blocks)],
  ['crdt', (blocks: ReturnType<typeof parseMarkdownToBlocks>) => {
    const doc = new Y.Doc();
    seedBlocks(doc, blocks);
    return createCrdtBlockStore(doc);
  }],
] as Array<[string, (blocks: ReturnType<typeof parseMarkdownToBlocks>) => BlockStore]>)('%s block store', (_name, make) => {
  it('reads back what it was seeded with', () => {
    const store = make(parseMarkdownToBlocks('one\n\ntwo'));
    expect(store.snapshot().map((b) => b.text)).toEqual(['one', 'two']);
  });

  it('returns a STABLE snapshot until something changes', () => {
    const store = make(parseMarkdownToBlocks('one'));
    expect(store.snapshot()).toBe(store.snapshot());
    store.setText(store.snapshot()[0]!.id, 'two');
    expect(store.snapshot()[0]!.text).toBe('two');
  });

  it('notifies subscribers on a change and stops after unsubscribe', () => {
    const store = make(parseMarkdownToBlocks('one'));
    let calls = 0;
    const off = store.subscribe(() => { calls++; });
    store.setText(store.snapshot()[0]!.id, 'edited');
    expect(calls).toBe(1);
    off();
    store.setText(store.snapshot()[0]!.id, 'again');
    expect(calls).toBe(1);
  });

  it('inserts after a block, and at the top for a null anchor', () => {
    const store = make(parseMarkdownToBlocks('one\n\ntwo'));
    const first = store.snapshot()[0]!.id;
    store.insertAfter(first, { ...emptyBlock(), text: 'middle' });
    store.insertAfter(null, { ...emptyBlock(), text: 'top' });
    expect(store.snapshot().map((b) => b.text)).toEqual(['top', 'one', 'middle', 'two']);
  });

  it('never leaves the document with no blocks', () => {
    const store = make(parseMarkdownToBlocks('only'));
    store.remove(store.snapshot()[0]!.id);
    expect(store.snapshot()).toHaveLength(1);
    expect(store.snapshot()[0]!.text).toBe('');
  });

  it('moves a block, clamping at the ends instead of wrapping', () => {
    const store = make(parseMarkdownToBlocks('a\n\nb\n\nc'));
    store.move(store.snapshot()[2]!.id, -1);
    expect(store.snapshot().map((b) => b.text)).toEqual(['a', 'c', 'b']);
    store.move(store.snapshot()[0]!.id, -5);
    expect(store.snapshot().map((b) => b.text)).toEqual(['a', 'c', 'b']);
  });

  it('merges attributes rather than replacing the whole set', () => {
    const store = make(parseMarkdownToBlocks('![alt](https://cdn/a.png)'));
    const id = store.snapshot()[0]!.id;
    store.setAttrs(id, { label: 'new alt' });
    expect(store.snapshot()[0]!.attrs).toEqual({ label: 'new alt', url: 'https://cdn/a.png' });
  });
});

describe('the per-block CRDT', () => {
  it('does not seed a document that already has content', () => {
    const doc = new Y.Doc();
    seedBlocks(doc, parseMarkdownToBlocks('first'));
    expect(seedBlocks(doc, parseMarkdownToBlocks('second'))).toBe(false);
    expect(blocksArray(doc)).toHaveLength(1);
  });

  /**
   * THE reason this exists. Under the old single-`Y.Text` document these two edits
   * were interleaved insertions into one sequence; whether the result read as two
   * paragraphs depended on where each client's offsets happened to land.
   */
  it('lets two people edit different blocks with no interference', () => {
    const { a, b } = pair();
    seedBlocks(a, parseMarkdownToBlocks('alpha\n\nbeta'));
    const storeA = createCrdtBlockStore(a, 'a');
    const storeB = createCrdtBlockStore(b, 'b');

    storeA.setText(storeA.snapshot()[0]!.id, 'alpha edited by A');
    storeB.setText(storeB.snapshot()[1]!.id, 'beta edited by B');

    expect(blocksToMarkdown(storeA.snapshot())).toBe('alpha edited by A\n\nbeta edited by B');
    expect(blocksToMarkdown(storeB.snapshot())).toBe(blocksToMarkdown(storeA.snapshot()));
  });

  it('merges two people typing into the SAME block character-wise, losing neither', () => {
    const { a, b } = pair();
    seedBlocks(a, parseMarkdownToBlocks('start'));
    const storeA = createCrdtBlockStore(a, 'a');
    const storeB = createCrdtBlockStore(b, 'b');
    const id = storeA.snapshot()[0]!.id;

    storeA.setText(id, 'start A');
    storeB.setText(id, 'B start A');

    const text = storeA.snapshot()[0]!.text;
    expect(storeB.snapshot()[0]!.text).toBe(text);
    expect(text).toContain('start');
    expect(text).toContain('A');
    expect(text).toContain('B');
  });

  it('writes an EDIT, not the whole value — a peer sees one insertion, not a rewrite', () => {
    const { a, b } = pair();
    seedBlocks(a, parseMarkdownToBlocks('hello world'));
    const storeA = createCrdtBlockStore(a, 'a');
    const shared = blocksArray(b).get(0)!.get('text') as Y.Text;

    const events: Array<{ retain?: number; insert?: unknown; delete?: number }[]> = [];
    shared.observe((event) => { events.push(event.delta as never); });
    storeA.setText(storeA.snapshot()[0]!.id, 'hello cruel world');

    // `retain 6` then `insert 'cruel '` — the untouched prefix and suffix are never
    // rewritten, which is what preserves every other participant's caret.
    expect(events).toEqual([[{ retain: 6 }, { insert: 'cruel ' }]]);
  });

  it('propagates an insert and a delete to the peer', () => {
    const { a, b } = pair();
    seedBlocks(a, parseMarkdownToBlocks('one'));
    const storeA = createCrdtBlockStore(a, 'a');
    const storeB = createCrdtBlockStore(b, 'b');

    storeA.insertAfter(storeA.snapshot()[0]!.id, { ...emptyBlock(), text: 'two' });
    expect(storeB.snapshot().map((block) => block.text)).toEqual(['one', 'two']);

    storeB.remove(storeB.snapshot()[0]!.id);
    expect(storeA.snapshot().map((block) => block.text)).toEqual(['two']);
  });

  it('stops observing after destroy, so a torn-down editor cannot be re-rendered', () => {
    const doc = new Y.Doc();
    seedBlocks(doc, parseMarkdownToBlocks('one'));
    const store = createCrdtBlockStore(doc);
    let calls = 0;
    store.subscribe(() => { calls++; });
    store.destroy();
    createCrdtBlockStore(doc, 'other').setText(fromId(doc), 'changed');
    expect(calls).toBe(0);
  });
});

function fromId(doc: Y.Doc): string {
  return String(blocksArray(doc).get(0)!.get('id'));
}
