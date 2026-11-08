import { blocksToMarkdown, createBlockId, type DocumentBlock } from './blockDocument';

/**
 * A DRAWING, AS A MODEL SEES IT.
 *
 * A `drawing` block serialises to a fenced `bf-drawing` block of stroke coordinates: thousands
 * of numbers a model can neither use nor reproduce. Sent as-is it bloats the prompt; sent as a
 * summary and then applied back with "replace", the model's answer has no drawing in it and
 * the drawings are deleted.
 *
 * So a drawing travels to a model as ONE stable line, `[[bf-drawing:N]]` (N = 1-based position
 * among the document's drawings), and `restoreDrawings` swaps each such line in the answer
 * back for the original drawing block, appending any the model dropped. The server's
 * `knowledgeText` (api/src/application/knowledge/documentText.ts) renders the SAME line, so the
 * analysis route's flow round-trips; both sides pin the format in a test. Ordinals rather than
 * block ids because the stored markdown (all the server has) carries no block ids.
 */

/** The placeholder line for the Nth (1-based) drawing. */
export function drawingPlaceholder(ordinal: number): string {
  return `[[bf-drawing:${ordinal}]]`;
}

const PLACEHOLDER_LINE = /^\[\[bf-drawing:(\d+)\]\]$/;

/** The document as markdown for a model: every drawing block replaced by its placeholder. */
export function toModelText(blocks: readonly DocumentBlock[]): string {
  let ordinal = 0;
  return blocksToMarkdown(blocks.map((block) => (
    block.type === 'drawing' ? { id: block.id, type: 'text' as const, text: drawingPlaceholder(++ordinal), attrs: {} } : block
  )));
}

/**
 * `restoreDrawings` for a result that was numbered from `snapshot` (what the model was sent) while the
 * document may have moved on: placeholders resolve by the SNAPSHOT's drawing order, each to its LIVE
 * block when it still exists (so later drawing edits are kept), else to its snapshot version. Drawings
 * added since the snapshot have no number, so they are appended like any drawing the model dropped.
 */
export function restoreAgainstSnapshot(result: readonly DocumentBlock[], snapshot: readonly DocumentBlock[], live: readonly DocumentBlock[]): DocumentBlock[] {
  const liveById = new Map(live.map((block) => [block.id, block]));
  const snapshotIds = new Set(snapshot.map((block) => block.id));
  const numbered = snapshot.filter((block) => block.type === 'drawing').map((block) => liveById.get(block.id) ?? block);
  const added = live.filter((block) => block.type === 'drawing' && !snapshotIds.has(block.id));
  return restoreDrawings(result, [...numbered, ...added]);
}

/**
 * A model's result blocks with the original drawings put back.
 *
 * - A line that is exactly a placeholder becomes the original drawing block (same id, same strokes).
 * - A placeholder that names no original drawing, or one already restored, is dropped.
 * - With `appendDropped` (default), original drawings the result never mentioned are appended at
 *   the end, so a replace can never delete a drawing. Pass `false` for an INSERT, where the
 *   originals are already in the document.
 */
export function restoreDrawings(result: readonly DocumentBlock[], original: readonly DocumentBlock[], appendDropped = true): DocumentBlock[] {
  const drawings = original.filter((block) => block.type === 'drawing');
  const restored = new Set<number>();
  const out: DocumentBlock[] = [];

  for (const block of result) {
    if (block.type !== 'text' || !block.text.includes('[[bf-drawing:')) { out.push(block); continue; }
    let pending: string[] = [];
    let first = true;
    const flush = () => {
      const text = pending.join('\n').replace(/^\n+|\s+$/g, '');
      pending = [];
      if (!text) return;
      out.push({ ...block, id: first ? block.id : createBlockId(), text });
      first = false;
    };
    for (const line of block.text.split('\n')) {
      const index = Number(PLACEHOLDER_LINE.exec(line.trim())?.[1]) - 1;
      if (!PLACEHOLDER_LINE.test(line.trim())) { pending.push(line); continue; }
      flush();
      const drawing = drawings[index];
      if (drawing && !restored.has(index)) { restored.add(index); out.push(drawing); }
    }
    flush();
  }

  if (appendDropped) drawings.forEach((drawing, index) => { if (!restored.has(index)) out.push(drawing); });
  return out;
}
