/**
 * The attribute-span vocabulary, for the markdown pipeline that renders a
 * document CARD.
 *
 * The card is the fifth reader of a canvas document (with the page editor, the
 * print sheet, the Office writers and Brain), and it is the only one that goes
 * through `react-markdown`. Everything else parses the stored markdown itself
 * and can call `richFormat` directly; here the text has already been parsed into
 * an mdast tree by the time we see it, so the marks are applied as a tree
 * transform instead.
 *
 * ── WHY A REMARK PLUGIN AND NOT RAW HTML ────────────────────────────────────
 * The shared pipeline carries no `rehype-raw`, deliberately — it also renders
 * chat, where the markdown is model output and raw HTML would be an injection
 * surface. This transform is the safe equivalent for the one construct we do
 * want: a closed vocabulary, validated by `richFormat`, that can only ever
 * produce a `<span>` with a colour, a family, a size or an underline on it.
 *
 * ── WHAT MAKES IT FIDDLY ────────────────────────────────────────────────────
 * `[**loud**]{u}` does not arrive as one text node. Micromark finds no link
 * definition, so the label stays literal — but its CONTENTS are still parsed,
 * and the paragraph's children come through as `text("[")`, `strong("loud")`,
 * `text("]{u}")`. A span therefore spans SIBLINGS, and the transform has to
 * re-slice a run of children rather than rewrite one string.
 */

import {
  hasRichMarks, parseRichAttributes, readRichBlock, richMarksCss, type RichMarks,
} from '@builderforce/creation-canvas-contract';

/** The slice of mdast this transform needs. Declared here rather than imported
 * from `unist`, which is a transitive dependency and does not resolve under
 * pnpm's strict `node_modules` — the same reason `markdownPipeline` derives its
 * plugin-list type from `react-markdown`'s own props. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Block containers whose own text may end in an alignment suffix. */
const ALIGNABLE = new Set(['paragraph', 'heading', 'tableCell']);

/** `]{...}` — a span's closing bracket and its attributes. */
const CLOSE = /\]\{([^{}]*)\}/;

function textNode(value: string): MdNode {
  return { type: 'text', value };
}

function spanNode(children: MdNode[], marks: RichMarks): MdNode {
  return {
    type: 'richSpan',
    children,
    data: { hName: 'span', hProperties: { style: richMarksCss(marks) } },
  };
}

/**
 * Rewrite one run of children, replacing every `[…]{…}` with a span element.
 *
 * Scans left to right: an opening bracket looks for its closing bracket in the
 * same node or a later one, and a group whose attributes this vocabulary does
 * not define is left exactly as the author typed it — including the brackets.
 */
function applySpans(children: readonly MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  let index = 0;
  let carry: string | null = null;

  const valueAt = (position: number): string | null => {
    if (position === index && carry !== null) return carry;
    const node = children[position];
    return node && node.type === 'text' ? node.value ?? '' : null;
  };

  while (index < children.length) {
    const value = valueAt(index);
    const open = value === null ? -1 : value.indexOf('[');
    if (open < 0) {
      out.push(value === null ? children[index]! : textNode(value));
      carry = null;
      index += 1;
      continue;
    }

    // Find the closing bracket: this node after the opening one, or a later one.
    let closeIndex = -1;
    let close: RegExpExecArray | null = null;
    const own = CLOSE.exec(value!.slice(open));
    if (own) { closeIndex = index; close = own; } else {
      for (let scan = index + 1; scan < children.length; scan += 1) {
        const scanned = children[scan];
        if (!scanned || scanned.type !== 'text') continue;
        const found = CLOSE.exec(scanned.value ?? '');
        if (found) { closeIndex = scan; close = found; break; }
      }
    }

    const attributes = close ? parseRichAttributes(close[1]!) : null;
    if (!close || !attributes?.recognised || !hasRichMarks(attributes.marks)) {
      // Not a span. Keep the bracket and move past it so the next `[` is still
      // considered — a paragraph may hold one of each.
      out.push(textNode(value!.slice(0, open + 1)));
      carry = value!.slice(open + 1);
      if (!carry) { carry = null; index += 1; }
      continue;
    }

    const closeAt = closeIndex === index ? open + close.index : close.index;
    const before = value!.slice(0, open);
    if (before) out.push(textNode(before));

    const inner: MdNode[] = [];
    if (closeIndex === index) {
      const between = value!.slice(open + 1, closeAt);
      if (between) inner.push(textNode(between));
    } else {
      const after = value!.slice(open + 1);
      if (after) inner.push(textNode(after));
      for (let scan = index + 1; scan < closeIndex; scan += 1) inner.push(children[scan]!);
      const head = (children[closeIndex]!.value ?? '').slice(0, closeAt);
      if (head) inner.push(textNode(head));
    }

    // The slices are re-scanned, not re-transformed: their nodes came through
    // `transform` already, but a bracket pair may sit inside this one.
    out.push(spanNode(applySpans(inner), attributes.marks));
    const rest = (closeIndex === index ? value! : children[closeIndex]!.value ?? '').slice(closeAt + close[0].length);
    index = closeIndex;
    carry = rest;
    if (!rest) { carry = null; index += 1; }
  }
  return out;
}

/** A block's alignment suffix, taken off its last text node and applied to the
 *  element the block renders as. */
function applyAlignment(node: MdNode): void {
  const children = node.children;
  if (!children?.length) return;
  const last = children[children.length - 1];
  if (!last || last.type !== 'text') return;
  const block = readRichBlock(last.value ?? '');
  if (!block.align) return;
  last.value = block.text;
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, style: `text-align:${block.align}` } };
}

/** Depth-first: align the block, then span its children. */
function transform(node: MdNode): MdNode {
  if (node.type === 'inlineCode' || node.type === 'code' || node.type === 'html') return node;
  if (ALIGNABLE.has(node.type)) applyAlignment(node);
  if (node.children) node.children = applySpans(node.children.map(transform));
  return node;
}

/**
 * Render `[text]{u color=… font=… size=…}` and `{align=…}` in a document.
 *
 * Added to the pipeline for DOCUMENT surfaces only — see
 * `DOCUMENT_REMARK_PLUGINS` in `markdownPipeline`.
 */
export function remarkRichFormat() {
  return (tree: MdNode): void => { transform(tree); };
}
