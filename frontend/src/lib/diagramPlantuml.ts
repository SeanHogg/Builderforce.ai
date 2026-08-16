/**
 * PlantUML reader and writer, for its component / deployment vocabulary.
 *
 * PlantUML is the notation that lives in engineering documentation — it is what
 * Confluence, Doxygen, Sphinx and most internal wikis render inline, so an
 * architecture picture that has to live NEXT TO the docs is usually a `.puml`.
 * Reading it means that diagram can be worked on here; writing it means a
 * diagram drawn here can go back to where the documentation is.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * The declaration-and-arrow vocabulary — `rectangle "X" as x`, `[Component]`,
 * `(Use case)`, `database`, `node`, and the arrow forms between them. That is
 * the subset that IS a labelled graph.
 *
 * Sequence diagrams and activity (`start` / `:step;` / `stop`) syntax are not,
 * for the same reason Mermaid's are not: their meaning is an order, not a set
 * of boxes. They are left unread rather than flattened into a wrong picture.
 */

import {
  layoutDiagramGraph, type DiagramGraph, type DiagramShape, type LayoutLink, type LayoutNode,
} from './diagramGraph';

/**
 * The body between the directives.
 *
 * The optional part after `@startuml` is a NAME on the same line
 * (`@startuml deployment`), so it is matched with horizontal whitespace only.
 * Written as `\s+`, it matched the newline instead and swallowed the first line
 * of the diagram — which silently dropped whatever was declared there, and left
 * a one-line diagram reading as empty.
 */
const BLOCK = /@startuml(?:[^\S\n]+[^\n]*)?\n([\s\S]*?)@enduml/i;

/** PlantUML's container keywords, mapped to the shape each one draws as. */
const SHAPE_BY_KEYWORD: Readonly<Record<string, DiagramShape>> = {
  rectangle: 'rect', component: 'rect', package: 'rect', frame: 'rect', stack: 'rect', class: 'rect', entity: 'rect', state: 'rounded',
  card: 'rounded', node: 'rounded', cloud: 'rounded', person: 'rounded', actor: 'rounded', collections: 'rect',
  usecase: 'ellipse', interface: 'ellipse', control: 'ellipse', boundary: 'ellipse', circle: 'ellipse',
  database: 'cylinder', queue: 'cylinder', storage: 'cylinder',
  hexagon: 'hexagon', file: 'note', artifact: 'note', folder: 'note', agent: 'rect', label: 'text',
};

const KEYWORD_BY_SHAPE: Readonly<Record<DiagramShape, string>> = {
  rect: 'rectangle', rounded: 'card', ellipse: 'usecase', cylinder: 'database',
  hexagon: 'hexagon', note: 'file', text: 'label',
  // PlantUML's component vocabulary has no diamond and no wedge. `hexagon` is
  // the nearest shape that still reads as "not a box", which keeps a decision
  // node visually distinct instead of collapsing into the surrounding steps.
  rhombus: 'hexagon', triangle: 'hexagon',
};

/** `rectangle "Order service" as orders #LightBlue` */
const DECLARATION = new RegExp(`^\\s*(${Object.keys(SHAPE_BY_KEYWORD).join('|')})\\s+(?:"([^"]*)"|([A-Za-z_][\\w.]*))(?:\\s+as\\s+([A-Za-z_][\\w.]*|"[^"]*"))?\\s*(#[\\w]+)?\\s*\\{?\\s*$`, 'i');

/**
 * The arrow forms this reads. Longest first, and `<`-leading forms are kept so
 * a reversed arrow can be flipped rather than silently pointing the wrong way.
 */
const ARROW = /\s*(<\|--|--\|>|<\|\.\.|\.\.\|>|<\.\.|\.\.>|<--|-->|<-|->|\.\.|--|==>|<==|==)\s*/;
/** A colour or length hint inside the arrow: `-[#red]->`, `-[hidden]-`. */
const ARROW_HINT = /-\[[^\]]*\]-?/g;

const TOKEN = /^(?:\[([^\]]+)\]|\(([^)]+)\)|"([^"]+)"|([A-Za-z_][\w.]*))$/;

/** Lines that are directives, styling or structure rather than declarations. */
const IGNORED = /^\s*(?:'|\/'|!|@|skinparam\b|hide\b|show\b|title\b|header\b|footer\b|legend\b|note\b|end\s|caption\b|scale\b|left\s+to\b|top\s+to\b|autonumber\b|newpage\b|\}|participant\b|start\b|stop\b|if\b|else\b|endif\b|while\b|repeat\b|fork\b|partition\b|:)/i;

interface Declared { id: string; label: string; shape: DiagramShape }

function tokenNode(raw: string): Declared | null {
  const token = raw.trim().replace(/\s+as\s+[A-Za-z_][\w.]*$/i, '').trim();
  const match = TOKEN.exec(token);
  if (!match) return null;
  // `[Thing]` is component shorthand and `(Thing)` is use-case shorthand; both
  // name the node by its label, which is how PlantUML itself resolves them.
  if (match[1]) return { id: match[1].trim(), label: match[1].trim(), shape: 'rect' };
  if (match[2]) return { id: match[2].trim(), label: match[2].trim(), shape: 'ellipse' };
  if (match[3]) return { id: match[3].trim(), label: match[3].trim(), shape: 'rect' };
  return match[4] ? { id: match[4], label: match[4], shape: 'rect' } : null;
}

export function readPlantuml(source: string): DiagramGraph | null {
  const body = BLOCK.exec(source)?.[1] ?? (/@startuml/i.test(source) ? source.replace(/@startuml[^\n]*\n?/i, '') : null);
  if (body === null) return null;

  const nodes = new Map<string, LayoutNode>();
  const links: LayoutLink[] = [];
  const remember = (declared: Declared): void => {
    const existing = nodes.get(declared.id);
    if (existing && existing.label !== existing.id) return;
    nodes.set(declared.id, { id: declared.id, label: declared.label, shape: declared.shape });
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/\s*'.*$/, '').trim();
    if (!line || IGNORED.test(line)) continue;

    const declaration = DECLARATION.exec(line);
    if (declaration) {
      const keyword = declaration[1]!.toLowerCase();
      const label = (declaration[2] ?? declaration[3] ?? '').trim();
      const alias = (declaration[4] ?? '').replace(/^"|"$/g, '').trim() || label;
      if (alias) remember({ id: alias, label: label || alias, shape: SHAPE_BY_KEYWORD[keyword] ?? 'rect' });
      continue;
    }

    const [connection, edgeLabel] = (() => {
      const colon = line.search(/\s+:\s+|\s+:$/);
      return colon >= 0 ? [line.slice(0, colon), line.slice(colon).replace(/^\s+:\s*/, '').trim()] : [line, ''];
    })();
    const normalized = connection.replace(ARROW_HINT, '--');
    const arrow = ARROW.exec(normalized);
    if (!arrow || arrow.index === 0) continue;
    const left = tokenNode(normalized.slice(0, arrow.index));
    const right = tokenNode(normalized.slice(arrow.index + arrow[0].length));
    if (!left || !right) continue;
    remember(left);
    remember(right);
    const reversed = arrow[1]!.startsWith('<');
    links.push({
      source: reversed ? right.id : left.id,
      target: reversed ? left.id : right.id,
      label: edgeLabel,
      dashed: arrow[1]!.includes('.'),
      arrow: /[>|]/.test(arrow[1]!),
    });
  }

  return layoutDiagramGraph([...nodes.values()], links);
}

/* ------------------------------------------------------------- writer --- */

function pumlAlias(graph: DiagramGraph): Map<string, string> {
  const used = new Set<string>();
  const aliases = new Map<string, string>();
  for (const vertex of graph.vertices) {
    const base = (vertex.id.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[^A-Za-z_]+/, '') || 'n').slice(0, 40);
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) { candidate = `${base}_${suffix}`; suffix += 1; }
    used.add(candidate);
    aliases.set(vertex.id, candidate);
  }
  return aliases;
}

const pumlLabel = (label: string): string => label.replaceAll('"', "'").replaceAll('\n', '\\n');

export function writePlantuml(graph: DiagramGraph): string {
  const aliases = pumlAlias(graph);
  const lines = ['@startuml', 'skinparam shadowing false', 'skinparam componentStyle rectangle', ''];
  for (const vertex of graph.vertices) {
    lines.push(`${KEYWORD_BY_SHAPE[vertex.shape]} "${pumlLabel(vertex.label || vertex.id)}" as ${aliases.get(vertex.id)}`);
  }
  if (graph.edges.length) lines.push('');
  for (const edge of graph.edges) {
    const from = edge.source ? aliases.get(edge.source) : undefined;
    const to = edge.target ? aliases.get(edge.target) : undefined;
    if (!from || !to) continue;
    const connector = edge.dashed ? (edge.arrow ? '..>' : '..') : (edge.arrow ? '-->' : '--');
    lines.push(`${from} ${connector} ${to}${edge.label ? ` : ${pumlLabel(edge.label)}` : ''}`);
  }
  lines.push('', '@enduml');
  return `${lines.join('\n')}\n`;
}
