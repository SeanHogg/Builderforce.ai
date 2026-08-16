/**
 * Mermaid flowchart reader and writer.
 *
 * Mermaid is the notation a diagram should be in when the diagram is going to
 * be MAINTAINED: it is plain text, so it diffs in a pull request, an agent can
 * edit one line of it without a round-trip through an editor, and it is the
 * only notation on this canvas a language model reliably writes correctly.
 * Draw.io is the notation it should be in when the diagram is going to be SENT.
 * The point of reading and writing both is that this stops being a choice a
 * person makes once, at the moment of creation, and has to live with.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * FLOWCHARTS (`flowchart` / `graph`) round-trip, because a flowchart is a graph
 * of labelled nodes and labelled edges and so is every other notation here.
 *
 * Mermaid's other diagram types — `sequenceDiagram`, `classDiagram`, `gantt`,
 * `erDiagram` and the rest — are NOT graphs of boxes. A sequence diagram's
 * meaning is in the ORDER of its messages down a lifeline, and flattening that
 * into vertices and edges would produce a picture that renders and lies. Those
 * are read as `null` here, which is what makes the conversion UI able to say
 * "this one only travels as Mermaid" instead of quietly mangling it. They still
 * render natively, and still export as `.mmd`.
 */

import {
  layoutDiagramGraph,
  type DiagramGraph, type DiagramShape, type LayoutLink, type LayoutNode,
} from './diagramGraph';

/** The header that makes a Mermaid document a flowchart. Anything else is one
 * of the diagram types that is not a node-and-edge graph. */
const FLOWCHART_HEADER = /^\s*(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)?\s*(?:;|$)/im;

/** Delimiter pairs, longest first — `[[` must be tried before `[`, or every
 * subroutine node reads as a rectangle whose label starts with a bracket. */
const NODE_DELIMITERS: ReadonlyArray<readonly [string, string, DiagramShape]> = [
  ['((', '))', 'ellipse'],
  ['([', '])', 'rounded'],
  ['[[', ']]', 'rect'],
  ['[(', ')]', 'cylinder'],
  ['{{', '}}', 'hexagon'],
  ['[/', '\\]', 'triangle'],
  ['[\\', '/]', 'triangle'],
  ['[/', '/]', 'rect'],
  ['[\\', '\\]', 'rect'],
  ['>', ']', 'note'],
  ['[', ']', 'rect'],
  ['(', ')', 'rounded'],
  ['{', '}', 'rhombus'],
];

/**
 * One connector, in every form Mermaid writes it.
 *
 * Captured as: the arrow body (which says solid / dotted / thick), an optional
 * `-- text --` inline label, and an optional `|text|` trailing label. Both
 * label forms exist in real files and mean the same thing.
 */
const CONNECTOR = /(<?)(-{2,}|-\.-*|={2,})(?:\s*([^->|]*?)\s*)?(-\.->|-{2,}>|={2,}>|-\.-|-{2,}|={2,}|>)(?:\|([^|]*)\|)?/;

const IDENTIFIER = /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/;

/** Mermaid escapes a character it would otherwise parse as syntax with its own
 * `#…;` entity — named or by code point. Both forms are decoded, because the
 * writer below emits them and a reader that only knew two of them turned its
 * own output back into literal `#124;`. */
const MERMAID_ENTITIES: Readonly<Record<string, string>> = {
  quot: '"', amp: '&', lt: '<', gt: '>', semi: ';', colon: ':', hash: '#', nbsp: ' ',
};

function unquote(value: string): string {
  const trimmed = value.trim();
  const inner = /^"([\s\S]*)"$/.exec(trimmed)?.[1] ?? /^'([\s\S]*)'$/.exec(trimmed)?.[1] ?? trimmed;
  return inner
    .replaceAll('<br/>', '\n').replaceAll('<br>', '\n').replaceAll('<br />', '\n')
    .replace(/#(\d{1,5}|[a-z]{2,5});/gi, (match, entity: string) => (
      /^\d+$/.test(entity) ? String.fromCodePoint(Number(entity)) : MERMAID_ENTITIES[entity.toLowerCase()] ?? match
    ))
    .trim();
}

interface ParsedNode { id: string; label: string; shape: DiagramShape }

/** `order([Take the order])` → the node it declares. Returns `null` for a token
 * that is not a node reference at all, so a stray fragment is skipped rather
 * than becoming an empty box. */
function parseNodeToken(raw: string): ParsedNode | null {
  const token = raw.trim().replace(/;+$/, '').trim();
  if (!token) return null;
  for (const [open, close, shape] of NODE_DELIMITERS) {
    const start = token.indexOf(open);
    if (start <= 0 || !token.endsWith(close)) continue;
    const id = token.slice(0, start).trim();
    const label = token.slice(start + open.length, token.length - close.length);
    if (!IDENTIFIER.test(id)) continue;
    return { id, label: unquote(label) || id, shape };
  }
  return IDENTIFIER.test(token) ? { id: token, label: token, shape: 'rect' } : null;
}

/** Lines that declare styling, interaction or grouping rather than structure.
 * `subgraph` is skipped but its CONTENTS are not — the nodes inside one are
 * real nodes, and dropping them would lose most of a grouped diagram. */
const IGNORED_LINE = /^\s*(?:%%|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|end\b|subgraph\b|accTitle\b|accDescr\b)/i;

/**
 * Read a Mermaid flowchart into geometry.
 *
 * Mermaid states relationships and never states position, so the graph is laid
 * out by the shared layered pass — the same one DOT and PlantUML use, so the
 * same flowchart written in three notations arrives on the board the same way.
 */
export function readMermaid(source: string): DiagramGraph | null {
  if (!FLOWCHART_HEADER.test(source)) return null;
  const nodes = new Map<string, ParsedNode>();
  const links: LayoutLink[] = [];

  const remember = (node: ParsedNode): void => {
    const existing = nodes.get(node.id);
    // A later mention that carries a label wins over a bare id reference: a
    // flowchart routinely names a node once and then refers to it by id.
    if (!existing || (existing.label === existing.id && node.label !== node.id)) nodes.set(node.id, node);
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(FLOWCHART_HEADER, '').trim();
    if (!line || IGNORED_LINE.test(rawLine)) continue;

    let rest = line;
    let previous: ParsedNode | null = null;
    let guard = 0;
    while (guard < 40) {
      guard += 1;
      const match = CONNECTOR.exec(rest);
      if (!match) break;
      const left = parseNodeToken(rest.slice(0, match.index));
      const from = left ?? previous;
      rest = rest.slice(match.index + match[0].length);
      // A chained line (`A --> B --> C`) puts the next connector inside what
      // would otherwise be the right-hand token, so the right node is read up
      // to the next connector rather than to the end of the line.
      const nextConnector = CONNECTOR.exec(rest);
      const rightToken = nextConnector ? rest.slice(0, nextConnector.index) : rest;
      const right = parseNodeToken(rightToken);
      if (left) remember(left);
      if (right) remember(right);
      if (from && right) {
        links.push({
          source: from.id,
          target: right.id,
          label: unquote(match[5] ?? match[3] ?? ''),
          dashed: match[2].includes('.') || match[4].includes('.'),
          arrow: match[4].endsWith('>'),
        });
      }
      previous = right;
      if (!nextConnector) break;
    }
    if (!previous && !CONNECTOR.test(line)) {
      const single = parseNodeToken(line);
      if (single) remember(single);
    }
  }

  const layoutNodes: LayoutNode[] = [...nodes.values()].map((node) => ({ id: node.id, label: node.label, shape: node.shape }));
  return layoutDiagramGraph(layoutNodes, links);
}

/* ------------------------------------------------------------- writer --- */

const WRAPPER_BY_SHAPE: Readonly<Record<DiagramShape, readonly [string, string]>> = {
  rect: ['[', ']'],
  rounded: ['(', ')'],
  ellipse: ['((', '))'],
  rhombus: ['{', '}'],
  hexagon: ['{{', '}}'],
  cylinder: ['[(', ')]'],
  triangle: ['[/', '\\]'],
  note: ['>', ']'],
  // Mermaid has no borderless node, so a draw.io text label becomes an ordinary
  // box. Silently dropping it would lose the annotation entirely, which is the
  // worse of the two honest options.
  text: ['[', ']'],
};

/** Mermaid ids may not carry spaces, quotes or its own delimiters. Stable per
 * graph, so the same source always writes the same file. */
function mermaidIds(graph: DiagramGraph): Map<string, string> {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const vertex of graph.vertices) {
    const base = (vertex.id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '') || 'n').slice(0, 40);
    let candidate = /^[0-9]/.test(base) ? `n${base}` : base;
    let suffix = 2;
    while (used.has(candidate)) { candidate = `${base}_${suffix}`; suffix += 1; }
    used.add(candidate);
    ids.set(vertex.id, candidate);
  }
  return ids;
}

/** Mermaid's numeric escape for a character it would otherwise parse as syntax.
 * Derived from the code point rather than spelled out, so the writer and the
 * reader above cannot disagree about which character an entity stands for. */
const mermaidEntity = (character: string): string => `#${character.codePointAt(0)};`;

/** Mermaid reads `"` as the end of a quoted label and `|` as the end of an edge
 * label, so both have to leave as entities rather than as themselves. */
function mermaidLabel(label: string): string {
  return label
    .replaceAll('"', mermaidEntity('"'))
    .replaceAll('|', mermaidEntity('|'))
    .replaceAll('\n', '<br/>')
    .trim();
}

export function writeMermaid(graph: DiagramGraph): string {
  const ids = mermaidIds(graph);
  const lines = ['flowchart TD'];
  for (const vertex of graph.vertices) {
    const [open, close] = WRAPPER_BY_SHAPE[vertex.shape];
    lines.push(`  ${ids.get(vertex.id)}${open}"${mermaidLabel(vertex.label || vertex.id)}"${close}`);
  }
  for (const edge of graph.edges) {
    const from = edge.source ? ids.get(edge.source) : undefined;
    const to = edge.target ? ids.get(edge.target) : undefined;
    // An edge whose ends are not two known shapes is not expressible in Mermaid
    // at all. Endpoints are recovered from geometry ONCE, before any writer
    // runs (`conversionFromGraph`); what is still unresolved here is dropped,
    // and COUNTED by that caller so the conversion can say what did not survive.
    if (!from || !to) continue;
    const connector = edge.dashed ? (edge.arrow ? '-.->' : '-.-') : (edge.arrow ? '-->' : '---');
    const label = mermaidLabel(edge.label);
    lines.push(`  ${from} ${connector}${label ? `|"${label}"|` : ''} ${to}`);
  }
  return `${lines.join('\n')}\n`;
}
