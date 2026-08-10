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
 */

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

/** Inline markdown → inline HTML. Code spans are masked out FIRST: `**` inside
 * backticks is literal text, not emphasis. */
function inlineToHtml(raw: string): string {
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

type ListEntry = { depth: number; ordered: boolean; text: string };

/** Nested lists, rendered by recursing on indentation depth rather than by
 * juggling an open-tag stack — the stack version is where mismatched `</ul>`
 * came from. Returns the HTML and the index it consumed up to. */
function listToHtml(entries: readonly ListEntry[], start: number, depth: number): [string, number] {
  const ordered = entries[start]!.ordered;
  const items: string[] = [];
  let index = start;
  let open: string | null = null;
  while (index < entries.length && entries[index]!.depth >= depth) {
    const entry = entries[index]!;
    if (entry.depth > depth) {
      const [nested, next] = listToHtml(entries, index, entry.depth);
      open = `${open ?? ''}${nested}`;
      index = next;
      continue;
    }
    if (entry.ordered !== ordered) break;
    if (open !== null) items.push(open);
    open = inlineToHtml(entry.text);
    index += 1;
  }
  if (open !== null) items.push(open);
  return [`<${ordered ? 'ol' : 'ul'}>${items.map((item) => `<li>${item}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`, index];
}

function tableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/** Indentation depth in list levels — two spaces or one tab per level, which is
 * what {@link htmlToMarkdown} writes back out. */
function listDepth(indent: string): number {
  return Math.floor(indent.replace(/\t/g, '  ').length / 2);
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
      blocks.push(`<h${heading[1]!.length}>${inlineToHtml(heading[2]!)}</h${heading[1]!.length}>`);
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
        if (bullet) entries.push({ depth: listDepth(bullet[1]!), ordered: false, text: bullet[2]! });
        else if (ordered) entries.push({ depth: listDepth(ordered[1]!), ordered: true, text: ordered[3]! });
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
    blocks.push(`<p>${inlineToHtml(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`);
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

function inlineMarkdown(nodes: readonly ChildNode[]): string {
  return nodes.map((node) => {
    if (node.nodeType === 3) return (node.textContent ?? '').replace(MARKDOWN_SPECIALS, '\\$1');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const children = Array.from(element.childNodes);
    const tag = element.tagName;
    if (tag === 'BR') return '\n';
    if (tag === 'IMG') return `![${(element.getAttribute('alt') ?? '').replace(/[[\]]/g, '')}](${element.getAttribute('src') ?? ''})`;
    if (tag === 'CODE') return `\`${(element.textContent ?? '').replace(/`/g, '')}\``;
    if (tag === 'A') {
      const href = element.getAttribute('href') ?? '';
      const text = inlineMarkdown(children) || href;
      return href ? `[${text}](${href})` : text;
    }
    const wrap = EMPHASIS[tag];
    if (wrap) {
      const text = inlineMarkdown(children);
      // `<b></b>` left behind by an undone format must not emit bare `****`.
      return text.trim() ? `${wrap}${text}${wrap}` : text;
    }
    return inlineMarkdown(children);
  }).join('');
}

function listMarkdown(list: Element, depth: number): string {
  const ordered = list.tagName === 'OL';
  const indent = '  '.repeat(depth);
  return Array.from(list.children).filter((child) => child.tagName === 'LI').map((item, position) => {
    const nested = Array.from(item.children).filter((child) => child.tagName === 'UL' || child.tagName === 'OL');
    const own = Array.from(item.childNodes).filter((child) => !nested.includes(child as Element));
    const text = inlineMarkdown(own).replace(/\s+/g, ' ').trim();
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
      if (text) blocks.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
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
      if (text) blocks.push(text);
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
  // Editing commands leave presentational wrappers behind; unwrap them to their
  // semantic equivalent so a bolded run survives the round trip.
  parsed.body.querySelectorAll('span,font').forEach((element) => {
    const weight = element.getAttribute('style') ?? '';
    const replacement = /font-weight\s*:\s*(bold|[6-9]00)/i.test(weight) ? 'strong'
      : /font-style\s*:\s*italic/i.test(weight) ? 'em'
        : /line-through/i.test(weight) ? 'del' : null;
    const target = replacement ? parsed.createElement(replacement) : parsed.createDocumentFragment();
    while (element.firstChild) target.appendChild(element.firstChild);
    element.replaceWith(target);
  });
  return blocksToMarkdown(Array.from(parsed.body.childNodes)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
