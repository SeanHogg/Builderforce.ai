/**
 * Graphviz DOT reader and writer.
 *
 * DOT is what a machine emits. Dependency graphs, call graphs, state machines,
 * schema relationships and build DAGs all come out of their tools as `.dot` or
 * `.gv`, and until now a person who had one could only look at it as text. It
 * is also the notation with the smallest gap between "a graph" and "a file":
 * `a -> b` is the whole language, which makes it the cheapest thing an agent
 * can write when it wants to hand back a structure rather than a picture.
 *
 * Attributes are read for what they mean visually — shape, label, fill, style —
 * and everything else in the language (ranks, ports, HTML labels, records) is
 * ignored rather than misdrawn.
 */

import {
  layoutDiagramGraph, type DiagramGraph, type DiagramShape, type LayoutLink, type LayoutNode,
} from './diagramGraph';

const HEADER = /^\s*(?:strict\s+)?(?:di)?graph\b/im;

const SHAPE_BY_DOT: Readonly<Record<string, DiagramShape>> = {
  box: 'rect', rect: 'rect', rectangle: 'rect', square: 'rect', none: 'text', plain: 'text', plaintext: 'text',
  ellipse: 'ellipse', oval: 'ellipse', circle: 'ellipse', doublecircle: 'ellipse', point: 'ellipse',
  diamond: 'rhombus', mdiamond: 'rhombus', hexagon: 'hexagon', triangle: 'triangle', invtriangle: 'triangle',
  cylinder: 'cylinder', note: 'note', folder: 'note', tab: 'note',
};

const DOT_BY_SHAPE: Readonly<Record<DiagramShape, string>> = {
  rect: 'box', rounded: 'box', ellipse: 'ellipse', rhombus: 'diamond',
  triangle: 'triangle', hexagon: 'hexagon', cylinder: 'cylinder', note: 'note', text: 'plaintext',
};

/** Graph-level statements that configure rendering rather than declare a node.
 * `node`/`edge`/`graph` here are DOT's default-attribute statements. */
const NON_NODE_KEYWORD = /^(?:node|edge|graph|rankdir|ranksep|nodesep|size|ratio|layout|splines|bgcolor|fontname|fontsize|label|labelloc|compound|newrank|concentrate)\b/i;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/^\s*#[^\n]*/gm, '');
}

/**
 * Split a DOT body into statements.
 *
 * Quote- and bracket-aware, because a label may legitimately contain `;` and an
 * attribute list always contains the separators a naive split would break on.
 * `subgraph … {` is flattened: its nodes are real nodes, and a cluster is a
 * visual grouping this canvas draws by position rather than by nesting.
 */
function statements(body: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  let brackets = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (quoted) {
      if (character === '"' && body[index - 1] !== '\\') quoted = false;
      current += character;
      continue;
    }
    if (character === '"') { quoted = true; current += character; continue; }
    if (character === '[') brackets += 1;
    if (character === ']') brackets = Math.max(0, brackets - 1);
    if (!brackets && (character === ';' || character === '\n' || character === '{' || character === '}')) {
      out.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  out.push(current);
  return out.map((statement) => statement.replace(/^\s*subgraph\b[^{]*/i, '').trim()).filter(Boolean);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const inner = /^"([\s\S]*)"$/.exec(trimmed)?.[1] ?? trimmed;
  return inner.replace(/\\"/g, '"').replace(/\\n|\\l|\\r/g, '\n').trim();
}

/** `label="Ship it", shape=box, style="rounded,filled"` → a flat lookup. */
function attributes(raw: string | undefined): Record<string, string> {
  const body = raw?.replace(/^\[/, '').replace(/\]$/, '') ?? '';
  const found: Record<string, string> = {};
  const pattern = /([A-Za-z_][\w]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^,\s\]]+)/g;
  let match = pattern.exec(body);
  while (match) {
    found[match[1]!.toLowerCase()] = unquote(match[2]!);
    match = pattern.exec(body);
  }
  return found;
}

const NODE_TOKEN = /^(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w.]*|\d+))(?::[\w.]+)*$/;

function nodeName(token: string): string | null {
  const match = NODE_TOKEN.exec(token.trim());
  if (!match) return null;
  return match[1] !== undefined ? unquote(`"${match[1]}"`) : (match[2] ?? null);
}

const EDGE_SPLIT = /\s*(->|--)\s*/;

export function readDot(source: string): DiagramGraph | null {
  const cleaned = stripComments(source);
  if (!HEADER.test(cleaned)) return null;
  const open = cleaned.indexOf('{');
  if (open < 0) return null;
  const close = cleaned.lastIndexOf('}');
  const body = cleaned.slice(open + 1, close < 0 ? undefined : close);

  const nodes = new Map<string, LayoutNode>();
  const links: LayoutLink[] = [];
  const defaults = { shape: 'ellipse' as DiagramShape };

  const ensure = (name: string, attrs: Record<string, string> = {}): LayoutNode => {
    const existing = nodes.get(name);
    const style = (attrs.style ?? '').toLowerCase();
    const declared = attrs.shape ? SHAPE_BY_DOT[attrs.shape.toLowerCase()] : undefined;
    const shape: DiagramShape = declared ?? (style.includes('rounded') ? 'rounded' : existing?.shape ?? defaults.shape);
    const node: LayoutNode = {
      id: name,
      label: attrs.label ? attrs.label : existing?.label ?? name,
      shape: declared === 'rect' && style.includes('rounded') ? 'rounded' : shape,
      ...(attrs.fillcolor ? { fill: attrs.fillcolor } : existing?.fill ? { fill: existing.fill } : {}),
      ...(attrs.color ? { stroke: attrs.color } : existing?.stroke ? { stroke: existing.stroke } : {}),
    };
    nodes.set(name, node);
    return node;
  };

  const directed = /\bdigraph\b/i.test(cleaned);
  for (const statement of statements(body)) {
    if (NON_NODE_KEYWORD.test(statement)) {
      // `node [shape=box]` changes the default for everything after it.
      const attrs = attributes(/\[([\s\S]*)\]/.exec(statement)?.[0]);
      if (/^node\b/i.test(statement) && attrs.shape) defaults.shape = SHAPE_BY_DOT[attrs.shape.toLowerCase()] ?? defaults.shape;
      continue;
    }
    const bracket = statement.indexOf('[');
    const head = (bracket >= 0 ? statement.slice(0, bracket) : statement).trim();
    const attrs = attributes(bracket >= 0 ? statement.slice(bracket) : undefined);
    if (!head) continue;

    if (EDGE_SPLIT.test(head)) {
      const parts = head.split(EDGE_SPLIT).map((part) => part.trim()).filter(Boolean);
      const names = parts.filter((part) => part !== '->' && part !== '--').map(nodeName);
      for (let index = 0; index + 1 < names.length; index += 1) {
        const from = names[index];
        const to = names[index + 1];
        if (!from || !to) continue;
        ensure(from);
        ensure(to);
        links.push({
          source: from,
          target: to,
          label: attrs.label ?? '',
          dashed: (attrs.style ?? '').toLowerCase().includes('dashed') || (attrs.style ?? '').toLowerCase().includes('dotted'),
          arrow: directed && attrs.dir !== 'none',
        });
      }
      continue;
    }
    const name = nodeName(head);
    if (name) ensure(name, attrs);
  }

  return layoutDiagramGraph([...nodes.values()], links);
}

/* ------------------------------------------------------------- writer --- */

function dotId(value: string): string {
  return /^[A-Za-z_][\w]*$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

function dotString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function writeDot(graph: DiagramGraph): string {
  const lines = ['digraph G {', '  rankdir=TB;', '  node [fontname="Helvetica", fontsize=11];', '  edge [fontname="Helvetica", fontsize=10];'];
  for (const vertex of graph.vertices) {
    const attrs = [`label=${dotString(vertex.label || vertex.id)}`, `shape=${DOT_BY_SHAPE[vertex.shape]}`];
    if (vertex.shape === 'rounded') attrs.push('style="rounded"');
    if (vertex.fill) attrs.push(`style="filled"`, `fillcolor=${dotString(vertex.fill)}`);
    if (vertex.stroke) attrs.push(`color=${dotString(vertex.stroke)}`);
    lines.push(`  ${dotId(vertex.id)} [${attrs.join(', ')}];`);
  }
  for (const edge of graph.edges) {
    if (!edge.source || !edge.target) continue;
    const attrs: string[] = [];
    if (edge.label) attrs.push(`label=${dotString(edge.label)}`);
    if (edge.dashed) attrs.push('style="dashed"');
    if (!edge.arrow) attrs.push('dir=none');
    lines.push(`  ${dotId(edge.source)} -> ${dotId(edge.target)}${attrs.length ? ` [${attrs.join(', ')}]` : ''};`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
