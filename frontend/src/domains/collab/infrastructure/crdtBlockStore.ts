import * as Y from 'yjs';
import { admitStrokes, patchedStroke, retainStrokes, type CanvasStroke } from '@/lib/canvasDrawing';
import { emptyBlock, type BlockAttrs, type DocumentBlock } from '../domain/blockDocument';
import { diffText } from '../domain/textDiff';
import { indexOfBlock, moveTarget, type BlockStore } from '../domain/blockStore';

/**
 * THE PER-BLOCK CRDT — a `Y.Array` of blocks, each holding its own `Y.Text`.
 *
 * ── WHAT THIS REPLACES ───────────────────────────────────────────────────────
 * One `Y.Text('content')` for the whole document. Yjs merged it correctly; the
 * problem was that "the document" was the only unit that existed. Two people
 * editing different paragraphs shared one sequence, so every remote keystroke
 * re-rendered the entire editor and moved the local caret, and the finest thing
 * presence could say was "somebody is in this document".
 *
 * Here the shared type is `Y.Array<Y.Map>`:
 *
 *   blocks: Y.Array<Y.Map<{ id: string, type: BlockType, text: Y.Text, attrs: object }>>
 *
 * The array orders the document; each map is one block; the `Y.Text` inside it is
 * the only thing typing touches. Two people in different blocks now produce
 * updates that touch disjoint sub-documents — they merge without either of them
 * observing a change — and a caret is `(blockId, offset)`, which is what makes a
 * block-level cursor expressible at all.
 *
 * ── WHY `attrs` IS A PLAIN OBJECT AND NOT A NESTED Y.MAP ─────────────────────
 * A media block's attributes change as a UNIT: an upload replaces the url, the
 * label and the mime together. Modelling them as three concurrently-mergeable
 * fields would let two uploads interleave into one block pointing at file A with
 * file B's name. Last-write-wins on the whole object is the correct semantics
 * here, and that is exactly what a plain value in a `Y.Map` gives.
 *
 * ── THE SNAPSHOT CONTRACT ────────────────────────────────────────────────────
 * `snapshot()` must return the same array until something changes, or
 * `useSyncExternalStore` re-renders forever. The cache is invalidated by the
 * `observeDeep` handler and nowhere else, so there is one place that can be wrong.
 */

const BLOCKS_KEY = 'blocks';

/** The shared array. Named once so a reader and a writer cannot disagree. */
export function blocksArray(doc: Y.Doc): Y.Array<Y.Map<unknown>> {
  return doc.getArray<Y.Map<unknown>>(BLOCKS_KEY);
}

/** A block as a shared map. `Y.Text` is created here so a caller cannot forget it
 *  and leave a block whose text is an ordinary string nobody can co-edit. */
export function toYBlock(block: DocumentBlock): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', block.id);
  map.set('type', block.type);
  const text = new Y.Text();
  if (block.text) text.insert(0, block.text);
  map.set('text', text);
  const { strokes, ...rest } = block.attrs;
  map.set('attrs', rest);
  // A drawing's strokes are their OWN shared array (see STROKES_KEY), never part of the attrs value.
  // Every drawing block is born with its array, so no operation ever has to create one concurrently.
  if (strokes || block.type === 'drawing') map.set(STROKES_KEY, strokesToYArray(strokes ?? []));
  return map;
}

/**
 * ── STROKES ARE A `Y.Array` OF `Y.Map`s, NOT PART OF `attrs` ──────────────────
 * `attrs` is last-write-wins as a unit, which is right for an upload and wrong for a
 * drawing: two people drawing at once would each write the whole stroke list and one
 * set of strokes would vanish. A drawing block therefore keeps `strokes` as a sibling
 * `Y.Array` in the block's map, and EACH STROKE is itself a `Y.Map`
 * (`id, tool, points, stroke, strokeWidth` and, for a text stroke, a `Y.Text`).
 *
 * - An append is an array insert; an erase deletes that stroke's item. Concurrent edits
 *   merge to the union, and an erase only removes strokes the eraser had seen.
 * - An UPDATE mutates the stroke's map in place (text through its `Y.Text`), never
 *   delete+insert, so two people typing in one text stroke converge on ONE stroke, and
 *   an update that races an erase cannot resurrect the erased stroke.
 *
 * Strokes are reachable ONLY through the stroke ops (and initial block construction);
 * `setAttrs` ignores them, so there is no last-write-wins path to the stroke list.
 */
const STROKES_KEY = 'strokes';

type StrokeMap = Y.Map<unknown>;

function strokeToYMap(stroke: CanvasStroke): StrokeMap {
  const map = new Y.Map<unknown>();
  map.set('id', stroke.id);
  map.set('tool', stroke.tool);
  map.set('points', stroke.points);
  map.set('stroke', stroke.stroke);
  map.set('strokeWidth', stroke.strokeWidth);
  if (stroke.tool === 'text') {
    const text = new Y.Text();
    if (stroke.text) text.insert(0, stroke.text);
    map.set('text', text);
  }
  return map;
}

/**
 * Copies an EXISTING stroke list (seed, replace, move): sanitised and de-duplicated by `retainStrokes`,
 * which keeps the NEWEST strokes over the read ceiling. New appends go through `admitStrokes` instead.
 */
function strokesToYArray(strokes: readonly CanvasStroke[]): Y.Array<StrokeMap> {
  const array = new Y.Array<StrokeMap>();
  array.push(retainStrokes(strokes).map(strokeToYMap));
  return array;
}

const readStroke = (map: StrokeMap): CanvasStroke => map.toJSON() as CanvasStroke;

/** One shared map, read back as a plain block. */
export function fromYBlock(map: Y.Map<unknown>): DocumentBlock {
  const text = map.get('text');
  const attrs: BlockAttrs = { ...((map.get('attrs') as BlockAttrs | undefined) ?? {}) };
  const shared = map.get(STROKES_KEY);
  if (shared instanceof Y.Array) attrs.strokes = (shared.toArray() as StrokeMap[]).map(readStroke);
  return {
    id: String(map.get('id') ?? ''),
    type: (map.get('type') as DocumentBlock['type']) ?? 'text',
    text: text instanceof Y.Text ? text.toString() : String(text ?? ''),
    attrs,
  };
}

/**
 * The block's shared stroke array. A drawing block is born with one, so a missing array
 * is unexpected; the op still has to land, so it is created here — and logged, because
 * two peers doing this at once would each create their own and one would win.
 */
function sharedStrokes(map: Y.Map<unknown>): Y.Array<StrokeMap> {
  const existing = map.get(STROKES_KEY);
  if (existing instanceof Y.Array) return existing as Y.Array<StrokeMap>;
  console.warn('[blockStore] drawing block had no strokes array; creating it', { blockId: map.get('id') });
  const created = new Y.Array<StrokeMap>();
  map.set(STROKES_KEY, created);
  return created;
}

/** The map for one stroke id, or null once it has been erased. */
function strokeMapFor(shared: Y.Array<StrokeMap>, strokeId: string): StrokeMap | null {
  for (const item of shared) if (item.get('id') === strokeId) return item;
  return null;
}

/**
 * Put `blocks` into an EMPTY shared document.
 *
 * Only when empty, and that is the whole safety property: the room is
 * server-authoritative and answers the sync handshake, so by the time a client is
 * synced the array either holds the document or the document has never existed.
 * Seeding a non-empty array would append a second copy of the text to whatever
 * everybody else is already looking at.
 */
export function seedBlocks(doc: Y.Doc, blocks: readonly DocumentBlock[]): boolean {
  const array = blocksArray(doc);
  if (array.length > 0) return false;
  const seed = blocks.length > 0 ? blocks : [emptyBlock()];
  doc.transact(() => array.insert(0, seed.map(toYBlock)), 'seed');
  return true;
}

/**
 * The {@link BlockStore} over a `Y.Doc`.
 *
 * @param origin Transaction origin for edits this client makes. Passed through so
 *               a caller can tell its own updates from a peer's — awareness and
 *               caret restoration both need that distinction.
 */
export function createCrdtBlockStore(doc: Y.Doc, origin: unknown = 'local'): BlockStore {
  const array = blocksArray(doc);
  const listeners = new Set<() => void>();
  let cached: readonly DocumentBlock[] | null = null;

  const read = (): readonly DocumentBlock[] => {
    if (cached === null) cached = array.toArray().map(fromYBlock);
    return cached;
  };

  const onChange = () => {
    cached = null;
    for (const listener of listeners) listener();
  };
  array.observeDeep(onChange);

  /** The shared map for a block id, or null. Read off the array rather than an
   *  index cache: the array is the order, and a stale index moves the wrong block. */
  const mapFor = (id: string): Y.Map<unknown> | null => {
    for (const map of array) if (map.get('id') === id) return map;
    return null;
  };

  return {
    snapshot: read,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setText(id, text) {
      const map = mapFor(id);
      const shared = map?.get('text');
      if (!(shared instanceof Y.Text)) return;
      const edit = diffText(shared.toString(), text);
      if (!edit) return;
      // ONE transaction, so a replacement (delete + insert) reaches every peer as a
      // single change rather than as a moment where the text is missing.
      doc.transact(() => {
        if (edit.remove > 0) shared.delete(edit.at, edit.remove);
        if (edit.insert) shared.insert(edit.at, edit.insert);
      }, origin);
    },

    setAttrs(id, attrs) {
      const map = mapFor(id);
      if (!map) return;
      // `strokes` is deliberately dropped: the stroke list changes only through the stroke ops.
      const { strokes: _ignored, ...plain } = attrs;
      const current = (map.get('attrs') as BlockAttrs | undefined) ?? {};
      doc.transact(() => map.set('attrs', { ...current, ...plain }), origin);
    },

    appendStrokes(id, strokes) {
      const map = mapFor(id);
      if (!map || strokes.length === 0) return;
      doc.transact(() => {
        const shared = sharedStrokes(map);
        // Sanitised, given unique ids and held to MAX_STROKES against what is there now.
        const admitted = admitStrokes((shared.toArray() as StrokeMap[]).map(readStroke), strokes);
        if (admitted.length > 0) shared.push(admitted.map(strokeToYMap));
      }, origin);
    },

    removeStrokes(id, strokeIds) {
      const map = mapFor(id);
      if (!map || strokeIds.length === 0) return;
      doc.transact(() => {
        const shared = sharedStrokes(map);
        // Back to front so a delete never shifts an index still to be visited.
        for (let index = shared.length - 1; index >= 0; index -= 1) {
          const stroke = shared.get(index).get('id');
          if (typeof stroke === 'string' && strokeIds.includes(stroke)) shared.delete(index, 1);
        }
      }, origin);
    },

    updateStroke(id, strokeId, patch) {
      const map = mapFor(id);
      if (!map) return;
      doc.transact(() => {
        // In place: a stroke erased in the meantime is simply not found, so it stays erased.
        const item = strokeMapFor(sharedStrokes(map), strokeId);
        if (!item) return;
        const all = (sharedStrokes(map).toArray() as StrokeMap[]).map(readStroke);
        const next = patchedStroke(readStroke(item), patch, all);
        if (!next) return;
        // The tool and id are the stroke's identity; everything else may change.
        if (JSON.stringify(item.get('points')) !== JSON.stringify(next.points)) item.set('points', next.points);
        if (item.get('stroke') !== next.stroke) item.set('stroke', next.stroke);
        if (item.get('strokeWidth') !== next.strokeWidth) item.set('strokeWidth', next.strokeWidth);
        if (next.tool === 'text') {
          const shared = item.get('text');
          if (shared instanceof Y.Text) {
            const edit = diffText(shared.toString(), next.text ?? '');
            if (edit?.remove) shared.delete(edit.at, edit.remove);
            if (edit?.insert) shared.insert(edit.at, edit.insert);
          }
        }
      }, origin);
    },

    clearStrokes(id) {
      const map = mapFor(id);
      if (!map) return;
      doc.transact(() => {
        const shared = sharedStrokes(map);
        if (shared.length > 0) shared.delete(0, shared.length);
      }, origin);
    },

    insertAfter(afterId, block) {
      const index = afterId === null ? -1 : indexOfBlock(read(), afterId);
      doc.transact(() => array.insert(index + 1, [toYBlock(block)]), origin);
      return block.id;
    },

    remove(id) {
      const index = indexOfBlock(read(), id);
      if (index < 0) return;
      doc.transact(() => {
        array.delete(index, 1);
        // Never leave the document with nothing: there would be nowhere to put the
        // caret, and the next person to open it would find an editor with no rows.
        if (array.length === 0) array.insert(0, [toYBlock(emptyBlock())]);
      }, origin);
    },

    move(id, delta) {
      const blocks = read();
      const target = moveTarget(blocks, id, delta);
      if (!target) return;
      const source = array.get(target.from);
      if (!source) return;
      // Yjs has no move: a block is re-created at the destination. Its `Y.Text` is
      // therefore a NEW sequence, so a peer typing into this block at the moment it
      // moves loses those keystrokes. That is the documented cost of a reorder, and
      // it is why moving is a button rather than something a drag does continuously.
      // The stroke array is re-created too, so a peer's concurrent stroke edits on this block are lost the same way (accepted).
      const copy = toYBlock(fromYBlock(source));
      doc.transact(() => {
        array.delete(target.from, 1);
        array.insert(target.to, [copy]);
      }, origin);
    },

    replaceAll(next) {
      const seed = next.length > 0 ? next : [emptyBlock()];
      // ONE transaction: every peer sees the replacement as a single change
      // rather than as a moment where the document has no blocks at all.
      doc.transact(() => {
        if (array.length > 0) array.delete(0, array.length);
        array.insert(0, seed.map(toYBlock));
      }, origin);
    },

    destroy() {
      array.unobserveDeep(onChange);
      listeners.clear();
    },
  };
}
