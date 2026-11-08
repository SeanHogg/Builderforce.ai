/**
 * A knowledge document as TEXT, for models and for the recall index.
 *
 * The page editor stores a drawing as a fenced `bf-drawing` block holding one line of
 * stroke JSON (see the frontend's `blockDocument.ts`). To a search index or an LLM that is
 * thousands of coordinates of noise, so each such fence is swapped for ONE placeholder line,
 * `[[bf-drawing:N]]` (N = 1-based position among the document's readable drawings). The
 * frontend's `drawingPlaceholders.ts` renders and restores the SAME line, so a model's
 * rewrite of the document round-trips its drawings; both sides pin the format in a test.
 * The stored content is never changed.
 *
 * Callers: ONLY the analysis route (`knowledgeRoutes.ts`) and `recallSops.ts`. The other
 * reads of `knowledge_documents.content` return it raw to the editor/API clients, which need
 * the fence; no embedding or search-index path reads a document's content as text.
 */

const DRAWING_FENCE = /```bf-drawing\r?\n([^\r\n]*)\r?\n```/g;

function isReadableDrawing(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as { strokes?: unknown } | null;
    return !!parsed && Array.isArray(parsed.strokes);
  } catch {
    return false;
  }
}

/** The placeholder line for the Nth (1-based) drawing. Mirror of the frontend's `drawingPlaceholder`. */
export function drawingPlaceholder(ordinal: number): string {
  return `[[bf-drawing:${ordinal}]]`;
}

export function knowledgeText(content: string): string {
  let ordinal = 0;
  return content.replace(DRAWING_FENCE, (_match, payload: string) => (
    // An unreadable fence is not a drawing block to the editor either, so it takes no ordinal.
    isReadableDrawing(payload) ? drawingPlaceholder(++ordinal) : '[drawing]'
  ));
}
