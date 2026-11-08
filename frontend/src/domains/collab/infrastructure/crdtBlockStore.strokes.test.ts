import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createCrdtBlockStore, seedBlocks } from './crdtBlockStore';
import { MAX_STROKES, type CanvasStroke } from '@/lib/canvasDrawing';

const stroke = (x: number): CanvasStroke => ({ tool: 'pen', points: [{ x, y: 0 }, { x: x + 1, y: 1 }], stroke: 'currentColor', strokeWidth: 3 });

/** Two docs that start identical and then exchange updates. */
function twoPeers() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  seedBlocks(a, [{ id: 'd', type: 'drawing', text: '', attrs: { strokes: [], width: 640, height: 320 } }]);
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  return { a, b, storeA: createCrdtBlockStore(a, 'a'), storeB: createCrdtBlockStore(b, 'b'), sync };
}

const ids = (store: ReturnType<typeof createCrdtBlockStore>) => (store.snapshot()[0]!.attrs.strokes ?? []).map((item) => item.id);

describe('drawing block strokes in the CRDT store', () => {
  it('merges concurrent appends from two peers to the union', () => {
    const { storeA, storeB, sync } = twoPeers();
    // Both draw while disconnected from each other.
    storeA.appendStrokes('d', [stroke(1), stroke(2)]);
    storeB.appendStrokes('d', [stroke(10)]);
    sync();
    expect(ids(storeA)).toHaveLength(3);
    expect(ids(storeA)).toEqual(ids(storeB));
    expect(new Set(ids(storeA)).size).toBe(3);
  });

  it('a concurrent erase and append keep the stroke the eraser never saw', () => {
    const { storeA, storeB, sync } = twoPeers();
    storeA.appendStrokes('d', [stroke(1)]);
    sync();
    const [victim] = ids(storeA);
    storeA.removeStrokes('d', [victim!]);
    storeB.appendStrokes('d', [stroke(50)]);
    sync();
    expect(ids(storeA)).toHaveLength(1);
    expect(ids(storeA)).not.toContain(victim);
    expect(ids(storeA)).toEqual(ids(storeB));
  });

  it('clear removes what the clearer saw but not a concurrent append', () => {
    const { storeA, storeB, sync } = twoPeers();
    storeA.appendStrokes('d', [stroke(1)]);
    sync();
    storeA.clearStrokes('d');
    storeB.appendStrokes('d', [stroke(9)]);
    sync();
    expect(ids(storeA)).toHaveLength(1);
    expect(ids(storeB)).toEqual(ids(storeA));
  });

  it('updates one stroke in place', () => {
    const { storeA, storeB, sync } = twoPeers();
    storeA.appendStrokes('d', [{ tool: 'text', points: [{ x: 1, y: 1 }], stroke: 'currentColor', strokeWidth: 3, text: '' }]);
    const [id] = ids(storeA);
    storeA.updateStroke('d', id!, { text: 'hello' });
    sync();
    expect(storeB.snapshot()[0]!.attrs.strokes?.[0]).toMatchObject({ id, text: 'hello' });
  });

  it('setAttrs ignores strokes — they change only through the stroke ops', () => {
    const { storeA, storeB, sync } = twoPeers();
    storeA.appendStrokes('d', [stroke(1)]);
    storeA.setAttrs('d', { strokes: [stroke(7), stroke(8)], width: 800 });
    sync();
    expect(ids(storeA)).toHaveLength(1);
    expect(storeB.snapshot()[0]!.attrs).toMatchObject({ width: 800 });
    expect(ids(storeB)).toEqual(ids(storeA));
  });

  const textStroke = (): CanvasStroke => ({ tool: 'text', points: [{ x: 1, y: 1 }], stroke: 'currentColor', strokeWidth: 3, text: '' });
  const textOf = (store: ReturnType<typeof createCrdtBlockStore>) => (store.snapshot()[0]!.attrs.strokes ?? []).map((item) => item.text);

  it('regression: two peers typing in the same text stroke converge to ONE stroke holding both edits', () => {
    const { storeA, storeB, sync } = twoPeers();
    storeA.appendStrokes('d', [textStroke()]);
    sync();
    const [id] = ids(storeA);
    storeA.updateStroke('d', id!, { text: 'abc' });
    storeB.updateStroke('d', id!, { text: 'xyz' });
    sync();
    expect(ids(storeA)).toHaveLength(1);
    expect(ids(storeB)).toEqual(ids(storeA));
    expect(textOf(storeA)).toEqual(textOf(storeB));
    const text = textOf(storeA)[0]!;
    expect(text).toHaveLength(6);
    expect(text).toContain('abc');
    expect(text).toContain('xyz');
  });

  it('regression: an update racing an erase leaves the stroke erased', () => {
    const { storeA, storeB, sync } = twoPeers();
    storeA.appendStrokes('d', [textStroke()]);
    sync();
    const [id] = ids(storeA);
    storeA.removeStrokes('d', [id!]);
    storeB.updateStroke('d', id!, { text: 'late edit' });
    sync();
    expect(ids(storeA)).toHaveLength(0);
    expect(ids(storeB)).toHaveLength(0);
  });

  it('bounds the write path: sanitises input, keeps ids unique and refuses appends past the cap', () => {
    const { storeA } = twoPeers();
    storeA.appendStrokes('d', [{ ...stroke(1), id: 'same' }, { ...stroke(2), id: 'same' }, { ...stroke(3), stroke: 'url(#evil)' }]);
    const strokes = storeA.snapshot()[0]!.attrs.strokes!;
    expect(new Set(strokes.map((item) => item.id)).size).toBe(3);
    expect(strokes[2]!.stroke).toBe('var(--indigo-bright)');
    storeA.appendStrokes('d', Array.from({ length: MAX_STROKES + 50 }, (_, index) => stroke(index)));
    expect(storeA.snapshot()[0]!.attrs.strokes).toHaveLength(MAX_STROKES);
    storeA.appendStrokes('d', [stroke(999)]);
    expect(storeA.snapshot()[0]!.attrs.strokes).toHaveLength(MAX_STROKES);
  });

  it('regression: seeding and moving a block with more than MAX_STROKES strokes keeps the NEWEST', () => {
    const doc = new Y.Doc();
    const many = Array.from({ length: MAX_STROKES + 100 }, (_, index) => ({ ...stroke(index), id: `s${index}` }));
    const last = `s${many.length - 1}`;
    seedBlocks(doc, [
      { id: 'd', type: 'drawing', text: '', attrs: { strokes: many, width: 640, height: 320 } },
      { id: 't', type: 'text', text: 'after', attrs: {} },
    ]);
    const store = createCrdtBlockStore(doc);
    const idsOf = () => (store.snapshot().find((block) => block.id === 'd')!.attrs.strokes ?? []).map((item) => item.id);
    expect(idsOf()).toHaveLength(many.length);
    expect(idsOf()).toContain(last);
    store.move('d', 1);
    expect(store.snapshot()[1]!.id).toBe('d');
    expect(idsOf()).toContain(last);
    expect(idsOf()).toHaveLength(many.length);
  });
});
