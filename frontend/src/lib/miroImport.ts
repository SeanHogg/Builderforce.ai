/**
 * A Miro board, as canvas objects.
 *
 * ── WHAT THIS IS AND IS NOT ──────────────────────────────────────────────────
 * This converts a board the person ALREADY HAS ACCESS TO, read through their own
 * Miro credential, into objects on their Builderforce canvas. It is the migration
 * path, and it is deliberately not a Miroverse scraper: the 7,000 community
 * templates are third-party creators' work published under Miro's Online Community
 * Terms, which license reuse *inside Miro boards*. Copying that library wholesale
 * into a competing product is not a feature, it is a lawsuit. What a person may do
 * — and what this supports — is copy a Miroverse template into their own Miro
 * account, which they are explicitly permitted to do, and then bring THAT board
 * across. Same outcome, one consent boundary respected.
 *
 * ── THE MAPPING, AND WHY IT LOSES ALMOST NOTHING ─────────────────────────────
 * A Miro board is mostly `sticky_note`, `text`, `shape`, `frame` and `connector`.
 * Every one of those has a home:
 *
 *   sticky_note → sticky      the pigment survives; Miro's named colours are
 *                             matched to the nearest board pigment
 *   text        → sticky      transparent, so it reads as text and not as a note
 *   shape       → sticky      with `stickyShape` remembering the geometry
 *   card        → task        a Miro card HAS an assignee and a due date, which
 *   app_card    → task        is a task in every sense but the name
 *   frame       → frame       ours is the same object: a titled region
 *   image       → image
 *   document    → file
 *   embed       → url         both are "a page pinned to the board"
 *   preview     → url
 *   connector   → an edge
 *   mindmap_node→ sticky + a `reference` edge to its parent
 *
 * The one thing that genuinely does not survive is a shape's exact geometry as
 * geometry — an ellipse arrives as a sticky that KNOWS it was an ellipse rather
 * than as a drawn ellipse. That is recorded on the object instead of silently
 * dropped, so a person can see what happened and a future shape renderer can read
 * it back without a second import.
 *
 * ── COORDINATES ──────────────────────────────────────────────────────────────
 * Miro positions an item by its CENTRE; React Flow positions a node by its
 * top-left. Converting needs the item's size, and Miro omits `geometry` on items
 * that have never been resized — so a missing width falls back to the default the
 * kind renders at rather than to zero, which would stack every unresized sticky on
 * one point. The board's own origin is arbitrary and often far from zero, so the
 * whole graph is translated to start near the canvas origin.
 *
 * Pure and synchronous on purpose: the fetching lives in the connector runtime
 * (`miro` manifest, `api/src/application/connectors/defaults/whiteboard.ts`), and
 * this is the part worth testing.
 */

import type { Edge } from '@xyflow/react';
import type { CreationFlowNode } from '@/components/creation-canvas/CreationNode';
import type { CreationNodeData, CreationObjectKind } from '@/components/creation-canvas/types';
import { STICKY_COLORS } from '@/components/creation-canvas/authoredColors';

// ---------------------------------------------------------------------------
// The Miro wire shapes
// ---------------------------------------------------------------------------

/** One item as `GET /v2/boards/{id}/items` returns it. Only the fields the mapping
 *  reads are declared; Miro sends a great deal more and it is ignored rather than
 *  typed, because an unknown field must never fail an import. */
export interface MiroItem {
  id: string;
  type: string;
  data?: {
    content?: string;
    title?: string;
    description?: string;
    shape?: string;
    url?: string;
    fileName?: string;
    dueDate?: string;
    assigneeId?: string;
    [key: string]: unknown;
  };
  style?: { fillColor?: string; [key: string]: unknown };
  position?: { x?: number; y?: number };
  geometry?: { width?: number; height?: number };
  parent?: { id?: string };
}

/** One connector as `GET /v2/boards/{id}/connectors` returns it. Connectors are a
 *  separate endpoint from items, which is why they are a separate argument here. */
export interface MiroConnector {
  id: string;
  startItem?: { id?: string };
  endItem?: { id?: string };
  captions?: Array<{ content?: string }>;
}

export interface MiroBoardSummary {
  id: string;
  name?: string;
  description?: string;
  viewLink?: string;
  modifiedAt?: string;
}

export interface MiroImportResult {
  nodes: CreationFlowNode[];
  edges: Edge[];
  /** What arrived as what, for the summary the panel shows after an import. A
   *  person who imported a 300-item board deserves to know that 6 items were of a
   *  type Miro itself calls unsupported, rather than counting cards to find out. */
  counts: Record<string, number>;
  /** Item types that had no home and were skipped, deduplicated. */
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * Miro item content is an HTML fragment (`<p>Hello<br>world</p>`), even on a
 * sticky note. Rendering that raw would put tags on the card, and running it
 * through a markdown converter would be the wrong tool — a sticky has no rich
 * text to preserve, only line breaks.
 *
 * Entities are decoded LAST so that a `&lt;p&gt;` written literally by a person
 * survives as text rather than being stripped as a tag on the pass before.
 */
export function miroTextToPlain(html: string | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Ampersand last, or `&amp;lt;` decodes twice and becomes `<`.
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * A title for a card whose text is a paragraph.
 *
 * A sticky keeps its whole text — the text IS the object. Everything else gets a
 * first line, because a `task` with a 400-character title makes the board
 * unreadable and the rest is kept in `content`.
 */
function firstLine(text: string, limit = 120): string {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0)?.trim() ?? '';
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Miro's sticky palette, mapped to the nearest board pigment.
 *
 * Miro sends a NAME (`light_yellow`), not a hex, and its palette is larger than
 * ours. Rather than invent six more pigments to hold a one-to-one mapping — which
 * would fork the palette the knowledge board and this one share — each Miro colour
 * lands on the closest member of `STICKY_COLORS`. A board comes across looking
 * like itself; it does not come across pixel-identical, and that is the honest
 * trade for one palette instead of two.
 */
const MIRO_COLOR_TO_PIGMENT: Readonly<Record<string, number>> = {
  gray: 0, light_yellow: 0, yellow: 0, orange: 4, light_green: 1, green: 1,
  dark_green: 1, cyan: 2, light_pink: 3, pink: 3, violet: 5, red: 4,
  light_blue: 2, blue: 2, dark_blue: 2, black: 5,
};

export function miroStickyColor(fill: string | undefined): string {
  if (!fill) return STICKY_COLORS[0]!;
  // A hex fill (shapes carry these) is the author's literal choice — keep it.
  if (/^#[0-9a-f]{6}$/i.test(fill)) return fill.toLowerCase();
  const index = MIRO_COLOR_TO_PIGMENT[fill.toLowerCase()];
  return STICKY_COLORS[index ?? 0]!;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** What each mapped kind renders at when Miro sends no geometry. Matches the
 *  widths in `CreationCanvas.module.css` so an unresized item lands the size it
 *  will actually draw at, and the layout does not jump on first paint. */
const DEFAULT_SIZE: Readonly<Record<string, { width: number; height: number }>> = {
  sticky: { width: 190, height: 170 },
  frame: { width: 520, height: 300 },
};
const FALLBACK_SIZE = { width: 300, height: 200 };

function sizeOf(item: MiroItem, kind: CreationObjectKind): { width: number; height: number } {
  const fallback = DEFAULT_SIZE[kind] ?? FALLBACK_SIZE;
  const width = typeof item.geometry?.width === 'number' && item.geometry.width > 0 ? item.geometry.width : fallback.width;
  const height = typeof item.geometry?.height === 'number' && item.geometry.height > 0 ? item.geometry.height : fallback.height;
  return { width, height };
}

// ---------------------------------------------------------------------------
// The item mapping
// ---------------------------------------------------------------------------

/** Which kind a Miro item type becomes. A type absent from here is skipped and
 *  REPORTED — Miro groups everything it does not model as `unsupported`, and
 *  silently dropping those would make an import look complete when it was not. */
const KIND_BY_MIRO_TYPE: Readonly<Record<string, CreationObjectKind>> = {
  sticky_note: 'sticky',
  text: 'sticky',
  shape: 'sticky',
  mindmap_node: 'sticky',
  card: 'task',
  app_card: 'task',
  frame: 'frame',
  image: 'image',
  document: 'file',
  embed: 'url',
  preview: 'url',
};

/** The data for one mapped object. Split out from the walk so the per-kind
 *  decisions are readable as a list rather than as a switch inside a loop. */
function dataFor(item: MiroItem, kind: CreationObjectKind, text: string): CreationNodeData {
  const base = { kind, title: firstLine(text) } as CreationNodeData;
  switch (kind) {
    case 'sticky':
      return {
        kind,
        // The whole text, not a first line — see `firstLine`.
        title: text,
        stickyColor: miroStickyColor(item.style?.fillColor),
        // What it WAS. A sticky that was a sticky says nothing; everything else
        // records the shape it arrived as — `rectangle`, `ellipse`, `text`,
        // `mindmap_node` — so a reader can see the ellipse in the original was
        // never a note, and a future shape renderer can read it back without a
        // second import.
        ...(item.type === 'sticky_note' ? {} : { stickyShape: item.data?.shape ?? item.type }),
      };
    case 'task':
      return {
        ...base,
        title: firstLine(miroTextToPlain(item.data?.title) || text) || text,
        ...(text ? { content: text } : {}),
        ...(item.data?.dueDate ? { dueDate: item.data.dueDate } : {}),
        status: 'Imported from Miro',
      };
    case 'frame':
      return { kind, title: miroTextToPlain(item.data?.title) || text || '', status: 'Canvas frame' };
    case 'image':
      return { ...base, title: base.title || item.data?.title || '', ...(item.data?.url ? { url: item.data.url } : {}) };
    case 'file':
      return {
        ...base,
        title: item.data?.title || item.data?.fileName || base.title || '',
        ...(item.data?.url ? { url: item.data.url } : {}),
        ...(item.data?.fileName ? { fileName: item.data.fileName } : {}),
      };
    case 'url':
      return { ...base, title: item.data?.title || base.title || item.data?.url || '', url: item.data?.url ?? '', viewport: 'desktop' };
    default:
      return base;
  }
}

/**
 * A Miro board as a canvas graph.
 *
 * `newId` is injected rather than calling `crypto.randomUUID()` inline so the
 * mapping is deterministic under test — the same reason the workflow scripts in
 * this repo take their clock from the caller.
 */
export function miroBoardToCanvas(
  items: readonly MiroItem[],
  connectors: readonly MiroConnector[] = [],
  newId: () => string = () => crypto.randomUUID(),
): MiroImportResult {
  const nodes: CreationFlowNode[] = [];
  const edges: Edge[] = [];
  const counts: Record<string, number> = {};
  const skipped = new Set<string>();
  /** Miro item id → the node id it became, so connectors and mind-map parents
   *  can be re-pointed at objects that now have different ids. */
  const idMap = new Map<string, string>();

  for (const item of items) {
    const kind = KIND_BY_MIRO_TYPE[item.type];
    if (!kind) { skipped.add(item.type); continue; }

    const text = miroTextToPlain(item.data?.content ?? item.data?.title ?? item.data?.description);
    // A frame with no title is still a region worth keeping; a sticky with no text
    // is an empty rectangle that was almost certainly scaffolding. Dropping it is
    // the difference between importing a board and importing its litter.
    if (!text && kind === 'sticky') { skipped.add(item.type); continue; }

    const id = newId();
    idMap.set(item.id, id);
    const { width, height } = sizeOf(item, kind);
    nodes.push({
      id,
      type: 'creation',
      // Centre-origin to top-left. See the coordinates note above.
      position: { x: (item.position?.x ?? 0) - width / 2, y: (item.position?.y ?? 0) - height / 2 },
      data: dataFor(item, kind, text),
      style: { width, height },
    } as CreationFlowNode);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }

  // A frame's children are `parent`-linked in Miro and `membership`-linked here,
  // which is the edge kind that already means "belongs to this group".
  for (const item of items) {
    const child = idMap.get(item.id);
    const parent = item.parent?.id ? idMap.get(item.parent.id) : undefined;
    if (!child || !parent || child === parent) continue;
    edges.push({ id: newId(), source: parent, target: child, type: 'smoothstep', data: { connectionKind: 'membership' } });
  }

  // Connectors become `reference` edges. Not `data` — a Miro arrow asserts that
  // two things are related and nothing about a value moving between them, and
  // `data` would make a coverage or lineage rollup read an imported doodle as a
  // pipeline. `reference` is the honest kind for "someone drew a line here".
  for (const connector of connectors) {
    const source = connector.startItem?.id ? idMap.get(connector.startItem.id) : undefined;
    const target = connector.endItem?.id ? idMap.get(connector.endItem.id) : undefined;
    if (!source || !target) continue;
    const label = miroTextToPlain(connector.captions?.find((caption) => caption.content)?.content);
    edges.push({
      id: newId(), source, target, type: 'smoothstep',
      ...(label ? { label } : {}),
      data: { connectionKind: 'reference' },
    });
  }

  return { nodes, edges: normalizeOrigin(nodes, edges), counts, skipped: [...skipped] };
}

/**
 * Translate the graph so its top-left sits near the canvas origin.
 *
 * A Miro board's coordinates are relative to a centre the person never chose and
 * are routinely in the tens of thousands. Importing them verbatim drops the whole
 * board somewhere off-screen and the person concludes nothing was imported.
 * Mutates `nodes` in place and returns `edges` unchanged so the caller reads as
 * one expression; the nodes were built in this function and are not shared.
 */
function normalizeOrigin(nodes: CreationFlowNode[], edges: Edge[]): Edge[] {
  if (!nodes.length) return edges;
  const minX = Math.min(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  const MARGIN = 80;
  for (const node of nodes) {
    node.position = { x: node.position.x - minX + MARGIN, y: node.position.y - minY + MARGIN };
  }
  return edges;
}
