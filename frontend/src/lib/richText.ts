/**
 * Markdown ↔ HTML — the ONE conversion behind every rich surface.
 *
 * A Canvas document is stored as markdown and nothing else: the card renders it,
 * the Files library sizes it, Brain reads it back as context, and the .docx
 * writer on the API turns it into a Word file. So a word-processor editor cannot
 * introduce a second storage format — it has to open markdown as HTML for a
 * `contenteditable` surface and write markdown back when the person stops
 * typing. The same `markdownToHtml` is what the print/PDF path renders, so what
 * gets edited, what gets printed, and what gets exported are one document.
 *
 * The pair is deliberately round-trip stable for everything it EMITS: any
 * construct `markdownToHtml` produces, `htmlToMarkdown` turns back into the
 * markdown it came from. That is the property that makes editing lossless —
 * opening a document and closing it without typing must not rewrite it.
 *
 * ── THE FOUR THINGS MARKDOWN CANNOT SPELL ───────────────────────────────────
 * Underline, colour, font and alignment have no markdown syntax, which is why
 * the toolbar used to stop where it stopped. They are carried instead by the
 * attribute spans `richFormat.ts` defines — `[the words]{u color=#c0392b}`, and
 * `{align=center}` on a block — which this module renders to HTML on the way in
 * and normalises a `contenteditable`'s own output back into on the way out. A
 * browser will hand back `<font color>`, `<span style="color:…">` or a
 * `text-align` on whichever element it felt like; all of it lands as the one
 * vocabulary every other reader parses.
 */

import {
  hasRichMarks, isRichAlign, mergeRichMarks, normalizeRichColor, normalizeRichFont, readRichBlock,
  richAlignFromCss, richMarksCss, richMarksFromCss, richSizeFromFontElement, sameRichMarks,
  splitRichSpans, wrapRichSpan, writeRichBlock,
  type RichAlign, type RichMarks,
} from '@builderforce/creation-canvas-contract';

const HTML_ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Escape text for interpolation into markup. Exported because the print
 * document builds a `<title>` from a user-authored string. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => HTML_ESCAPES[character]!);
}

/* ── markdown → HTML ─────────────────────────────────────────────────────── */

const FENCE = /^```([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*$/;
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^([ \t]*)[-*+]\s+(.*)$/;
const ORDERED = /^([ \t]*)(\d+)[.)]\s+(.*)$/;
const TABLE_RULE = /^\|?[\s:|-]*-[\s:|-]*\|?$/;
const CODE_SPAN = /`([^`\n]+)`/g;
const COMMENT = /^<!--([\s\S]*?)-->$/;
/** A placeholder no authored document contains, so masking a code span cannot
 * collide with the text around it. */
const MASK = '\u0000';

/** The marks a span carries, as the HTML an editing surface understands.
 * Underline is a `<u>` element rather than a CSS declaration because that is
 * what the browser's own underline command toggles and reports. */
function markedHtml(html: string, marks: RichMarks): string {
  if (!hasRichMarks(marks)) return html;
  const inner = marks.underline ? `<u>${html}</u>` : html;
  // Escaped, not interpolated raw: a font stack quotes any family with a space
  // in it, and an unescaped `"` ends the attribute early — which silently drops
  // every declaration after the font.
  const css = richMarksCss({ ...marks, underline: false });
  return css ? `<span style="${escapeHtml(css)}">${inner}</span>` : inner;
}

/** Inline markdown → inline HTML, attribute spans included. */
function inlineToHtml(raw: string): string {
  return splitRichSpans(raw).map((segment) => markedHtml(emphasisToHtml(segment.text), segment.marks)).join('');
}

/** Emphasis, links, images and code within ONE unmarked stretch. Code spans are
 * masked out FIRST: `**` inside backticks is literal text, not emphasis. */
function emphasisToHtml(raw: string): string {
  const codes: string[] = [];
  const masked = raw.replace(CODE_SPAN, (_match, code: string) => {
    codes.push(code);
    return `${MASK}${codes.length - 1}${MASK}`;
  });
  const html = escapeHtml(masked)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, '<a href="$2">$1</a>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w\\])__([^_]+)__/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\\])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    // Intra-word underscores are literal in GFM (`snake_case` is not emphasis),
    // so italics need a non-word character in front.
    .replace(/(^|[^\w\\])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/\\([\\*_`~[\]])/g, '$1');
  return html.replace(new RegExp(`${MASK}(\\d+)${MASK}`, 'g'), (_match, index: string) => `<code>${escapeHtml(codes[Number(index)] ?? '')}</code>`);
}

type ListEntry = { depth: number; ordered: boolean; text: string; align?: RichAlign };

/** Nested lists, rendered by recursing on indentation depth rather than by
 * juggling an open-tag stack — the stack version is where mismatched `</ul>`
 * came from. Returns the HTML and the index it consumed up to. */
function listToHtml(entries: readonly ListEntry[], start: number, depth: number): [string, number] {
  const ordered = entries[start]!.ordered;
  const items: string[] = [];
  let index = start;
  let open: string | null = null;
  let openAlign: RichAlign | undefined;
  const close = (): void => { if (open !== null) items.push(`<li${alignAttribute(openAlign)}>${open}</li>`); };
  while (index < entries.length && entries[index]!.depth >= depth) {
    const entry = entries[index]!;
    if (entry.depth > depth) {
      const [nested, next] = listToHtml(entries, index, entry.depth);
      open = `${open ?? ''}${nested}`;
      index = next;
      continue;
    }
    if (entry.ordered !== ordered) break;
    close();
    open = inlineToHtml(entry.text);
    openAlign = entry.align;
    index += 1;
  }
  close();
  return [`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`, index];
}

function tableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/** Indentation depth in list levels — two spaces or one tab per level, which is
 * what {@link htmlToMarkdown} writes back out. */
function listDepth(indent: string): number {
  return Math.floor(indent.replace(/\t/g, '  ').length / 2);
}

/** A block's alignment, as the style attribute an editable surface shows and
 * the browser's own alignment commands toggle. */
function alignAttribute(align: RichAlign | undefined): string {
  return align && align !== 'left' ? ` style="text-align:${align}"` : '';
}

/**
 * Markdown → HTML for an editable surface.
 *
 * Deliberately not `react-markdown`: that renders React elements, and a
 * `contenteditable` needs an HTML string it can own outright — React must not
 * reconcile a DOM the browser is mutating under the caret.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index += 1; continue; }

    const comment = COMMENT.exec(line.trim());
    if (comment) {
      // Comments carry structure the canvas depends on — a page break declared
      // by an imported Word or PDF file is `<!--page-break-->` — so they survive
      // a trip through the editor as real comment nodes rather than being
      // escaped into visible text or silently dropped.
      blocks.push(`<!--${comment[1]!.replace(/--+>?/g, '')}-->`);
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index]!.trim())) { body.push(lines[index]!); index += 1; }
      index += 1;
      blocks.push(`<pre><code${fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : ''}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const block = readRichBlock(heading[2]!);
      blocks.push(`<h${level}${alignAttribute(block.align)}>${inlineToHtml(block.text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (RULE.test(line.trim())) { blocks.push('<hr>'); index += 1; continue; }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) { quoted.push(QUOTE.exec(lines[index]!)![1]!); index += 1; }
      blocks.push(`<blockquote>${markdownToHtml(quoted.join('\n')) || '<p></p>'}</blockquote>`);
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1]!.trim()) && lines[index + 1]!.includes('-')) {
      const head = tableRow(line);
      index += 2;
      const body: string[][] = [];
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) { body.push(tableRow(lines[index]!)); index += 1; }
      blocks.push(`<table><thead><tr>${head.map((cell) => `<th>${inlineToHtml(cell)}</th>`).join('')}</tr></thead><tbody>${
        body.map((row) => `<tr>${head.map((_cell, column) => `<td>${inlineToHtml(row[column] ?? '')}</td>`).join('')}</tr>`).join('')
      }</tbody></table>`);
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const entries: ListEntry[] = [];
      while (index < lines.length) {
        const bullet = BULLET.exec(lines[index]!);
        const ordered = ORDERED.exec(lines[index]!);
        if (bullet) {
          const item = readRichBlock(bullet[2]!);
          entries.push({ depth: listDepth(bullet[1]!), ordered: false, text: item.text, ...(item.align ? { align: item.align } : {}) });
        } else if (ordered) {
          const item = readRichBlock(ordered[3]!);
          entries.push({ depth: listDepth(ordered[1]!), ordered: true, text: item.text, ...(item.align ? { align: item.align } : {}) });
        }
        else break;
        index += 1;
      }
      let cursor = 0;
      while (cursor < entries.length) {
        const [html, next] = listToHtml(entries, cursor, entries[cursor]!.depth);
        blocks.push(html);
        cursor = next > cursor ? next : cursor + 1;
      }
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() && !HEADING.test(lines[index]!) && !BULLET.test(lines[index]!)
      && !ORDERED.test(lines[index]!) && !QUOTE.test(lines[index]!) && !RULE.test(lines[index]!.trim()) && !FENCE.test(lines[index]!.trim())) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    const block = readRichBlock(paragraph.join('\n'));
    blocks.push(`<p${alignAttribute(block.align)}>${inlineToHtml(block.text).replace(/\n/g, '<br>')}</p>`);
  }
  return blocks.join('');
}

/* ── HTML → markdown ─────────────────────────────────────────────────────── */

/** Characters that would otherwise be read back as structure. `_` is left alone
 * on purpose — escaping every `snake_case` identifier is worse than the rare
 * intra-word italic, and {@link inlineToHtml} does not treat it as emphasis. */
const MARKDOWN_SPECIALS = /([\\*`~[\]])/g;

const EMPHASIS: Readonly<Record<string, string>> = {
  STRONG: '**', B: '**', EM: '*', I: '*', DEL: '~~', S: '~~', STRIKE: '~~',
};

/** A stretch of inline markdown and the marks the DOM had around it. */
interface InlineLeaf { text: string; marks: RichMarks }

/** The marks an element declares ITSELF — its tag, its style, and the legacy
 * `<font>` attributes a browser's own colour and size commands still emit. */
function elementMarks(element: Element): RichMarks {
  const tag = element.tagName;
  let marks: RichMarks = tag === 'U' || tag === 'INS' ? { underline: true } : {};
  marks = mergeRichMarks(marks, richMarksFromCss(element.getAttribute('style') ?? ''));
  if (tag !== 'FONT') return marks;
  const color = normalizeRichColor(element.getAttribute('color'));
  const font = normalizeRichFont(element.getAttribute('face'));
  const size = richSizeFromFontElement(element.getAttribute('size') ?? '');
  return mergeRichMarks(marks, {
    ...(color ? { color } : {}), ...(font ? { font } : {}), ...(size ? { size } : {}),
  });
}

/** The block alignment an element declares, however the engine spelled it. */
function elementAlign(element: Element): RichAlign | undefined {
  const attribute = (element.getAttribute('align') ?? '').toLowerCase();
  return richAlignFromCss(element.getAttribute('style') ?? '') ?? (isRichAlign(attribute) ? attribute : undefined);
}

/** Wrap in an emphasis marker with the surrounding whitespace left OUTSIDE it:
 * `**bold **` is not emphasis in markdown, it is two literal asterisks. */
function emphasize(text: string, marker: string): string {
  const parts = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const inner = parts?.[2] ?? '';
  // `<b></b>` left behind by an undone format must not emit bare `****`.
  return inner ? `${parts![1]}${marker}${inner}${marker}${parts![3]}` : text;
}

/**
 * Flatten inline DOM into leaves, each carrying the marks in force where it sits.
 *
 * Flattened rather than wrapped in place because the stored form puts the span
 * OUTSIDE the emphasis (`[**bold**]{u}`) while a browser nests them in whichever
 * order the commands were pressed, and because two marks on one word must become
 * ONE span — `[[word]{u}]{color=#c0392b}` is not a span, it is a bracket the
 * reader cannot pair.
 */
function inlineLeaves(nodes: readonly ChildNode[], marks: RichMarks): InlineLeaf[] {
  return nodes.flatMap((node): InlineLeaf[] => {
    if (node.nodeType === 3) return [{ text: (node.textContent ?? '').replace(MARKDOWN_SPECIALS, '\\$1'), marks }];
    if (node.nodeType !== 1) return [];
    const element = node as Element;
    const children = Array.from(element.childNodes);
    const tag = element.tagName;
    if (tag === 'BR') return [{ text: '\n', marks }];
    if (tag === 'IMG') return [{ text: `![${(element.getAttribute('alt') ?? '').replace(/[[\]]/g, '')}](${element.getAttribute('src') ?? ''})`, marks }];
    if (tag === 'CODE') return [{ text: `\`${(element.textContent ?? '').replace(/`/g, '')}\``, marks }];
    if (tag === 'A') {
      const href = element.getAttribute('href') ?? '';
      const text = inlineMarkdown(children) || href;
      return [{ text: href ? `[${text}](${href})` : text, marks }];
    }
    const own = mergeRichMarks(marks, elementMarks(element));
    const wrap = EMPHASIS[tag];
    const leaves = inlineLeaves(children, own);
    return wrap ? leaves.map((leaf) => ({ ...leaf, text: emphasize(leaf.text, wrap) })) : leaves;
  });
}

function inlineMarkdown(nodes: readonly ChildNode[], marks: RichMarks = {}): string {
  const merged: InlineLeaf[] = [];
  for (const leaf of inlineLeaves(nodes, marks)) {
    const last = merged[merged.length - 1];
    if (last && sameRichMarks(last.marks, leaf.marks)) last.text += leaf.text;
    else merged.push({ ...leaf });
  }
  // A span never straddles a line break: the block readers work a line at a time,
  // so a `[` on one line and its `]` on the next is a span nobody can pair.
  return merged.map((leaf) => leaf.text.split('\n').map((part) => wrapRichSpan(part, leaf.marks)).join('\n')).join('');
}

function listMarkdown(list: Element, depth: number): string {
  const ordered = list.tagName === 'OL';
  const indent = '  '.repeat(depth);
  return Array.from(list.children).filter((child) => child.tagName === 'LI').map((item, position) => {
    const nested = Array.from(item.children).filter((child) => child.tagName === 'UL' || child.tagName === 'OL');
    const own = Array.from(item.childNodes).filter((child) => !nested.includes(child as Element));
    const text = writeRichBlock(inlineMarkdown(own).replace(/\s+/g, ' ').trim(), elementAlign(item));
    const sub = nested.map((child) => listMarkdown(child, depth + 1)).join('\n');
    return `${indent}${ordered ? `${position + 1}. ` : '- '}${text}${sub ? `\n${sub}` : ''}`;
  }).join('\n');
}

function tableMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return '';
  const cells = (row: Element) => Array.from(row.children)
    .map((cell) => inlineMarkdown(Array.from(cell.childNodes)).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim());
  const head = cells(rows[0]!);
  if (!head.length) return '';
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => {
      const values = cells(row);
      return `| ${head.map((_cell, column) => values[column] ?? '').join(' | ')} |`;
    }),
  ].join('\n');
}

/** Tags that open a new block, so a nested one means recurse rather than read
 * the whole subtree as one line of prose. */
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'PRE', 'BLOCKQUOTE', 'HR', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'FIGURE']);

function blocksToMarkdown(nodes: readonly ChildNode[]): string[] {
  const blocks: string[] = [];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? '').trim();
      if (text) blocks.push(text.replace(MARKDOWN_SPECIALS, '\\$1'));
      continue;
    }
    if (node.nodeType === 8) {
      const data = (node.nodeValue ?? '').replace(/--+>?/g, '').trim();
      if (data) blocks.push(`<!--${data}-->`);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    const tag = element.tagName;
    const children = Array.from(element.childNodes);
    if (/^H[1-6]$/.test(tag)) {
      const text = inlineMarkdown(children).replace(/\s+/g, ' ').trim();
      if (text) blocks.push(`${'#'.repeat(Number(tag[1]))} ${writeRichBlock(text, elementAlign(element))}`);
      continue;
    }
    if (tag === 'UL' || tag === 'OL') { const list = listMarkdown(element, 0); if (list) blocks.push(list); continue; }
    if (tag === 'TABLE') { const table = tableMarkdown(element); if (table) blocks.push(table); continue; }
    if (tag === 'PRE') {
      const code = element.querySelector('code');
      const language = /language-([\w+-]+)/.exec(code?.className ?? '')?.[1] ?? '';
      blocks.push(`\`\`\`${language}\n${(code ?? element).textContent ?? ''}\n\`\`\``);
      continue;
    }
    if (tag === 'BLOCKQUOTE') {
      const inner = blocksToMarkdown(children).join('\n\n');
      if (inner.trim()) blocks.push(inner.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n'));
      continue;
    }
    if (tag === 'HR') { blocks.push('---'); continue; }
    if (tag === 'P' || tag === 'DIV') {
      // A `contenteditable` wraps a whole nested structure in a `<div>` as often
      // as it wraps a single line, so a block child means recurse, not paragraph.
      if (children.some((child) => child.nodeType === 1 && BLOCK_TAGS.has((child as Element).tagName))) {
        blocks.push(...blocksToMarkdown(children));
        continue;
      }
      const text = inlineMarkdown(children).replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
      if (text) blocks.push(writeRichBlock(text, elementAlign(element)));
      continue;
    }
    if (BLOCK_TAGS.has(tag)) { blocks.push(...blocksToMarkdown(children)); continue; }
    const inline = inlineMarkdown([node]).trim();
    if (inline) blocks.push(inline);
  }
  return blocks;
}

/**
 * HTML → markdown, for reading a `contenteditable` back into storage.
 *
 * Browsers do not agree on what an editing command produces — `<b>` here,
 * `<span style="font-weight:bold">` there, a `<div>` per line in one engine and
 * a `<p>` in another — so this normalizes whatever the surface holds down to the
 * markdown the rest of the system reads. Returns `''` outside a browser, where
 * there is no parser and nothing has been edited.
 */
export function htmlToMarkdown(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  parsed.body.querySelectorAll('script,style,meta,link').forEach((element) => element.remove());
  // Editing commands leave presentational wrappers behind. The emphasis they
  // express becomes a semantic element INSIDE the wrapper rather than replacing
  // it — the same `<span>` may also carry a colour, a font or a size, and those
  // are read off the element itself.
  parsed.body.querySelectorAll('span,font').forEach((element) => {
    const style = element.getAttribute('style') ?? '';
    const semantics = [
      /font-weight\s*:\s*(bold|[6-9]00)/i.test(style) ? 'strong' : '',
      /font-style\s*:\s*italic/i.test(style) ? 'em' : '',
      /line-through/i.test(style) ? 'del' : '',
    ].filter(Boolean);
    for (const name of semantics) {
      const wrapper = parsed.createElement(name);
      while (element.firstChild) wrapper.appendChild(element.firstChild);
      element.appendChild(wrapper);
    }
  });
  return blocksToMarkdown(Array.from(parsed.body.childNodes)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
