/**
 * Markdown → a small block model, shared by the Office exporters.
 *
 * The Brain's capability replies are markdown (a Document is headings +
 * paragraphs + lists + tables; a Slides reply is one `##` per slide; a
 * Spreadsheet reply is a table plus a ```csv fence). Both the .docx writer and
 * the .pptx renderer need the same structural read of that markdown, so the
 * parse lives here once rather than in each renderer.
 *
 * Deliberately a SUBSET — headings, paragraphs, bullet/ordered lists, GFM
 * tables, fenced code — matching what the capability prompts actually ask the
 * model to produce. Anything unrecognised degrades to a paragraph rather than
 * being dropped, so no content is silently lost on export.
 */

export type MdBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; lang: string; text: string };

/** One inline run of text with its emphasis flags. */
export interface MdRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

const TABLE_DIVIDER = /^\|?[\s:|-]+\|[\s:|-]*$/;

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Parse a markdown document into blocks. */
export function parseMarkdownBlocks(markdown: string): MdBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];

  const flushPara = () => {
    const text = para.join(' ').trim();
    para = [];
    if (text) blocks.push({ kind: 'paragraph', text });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Fenced code — consume to the closing fence (or EOF).
    const fence = /^\s*```+\s*([\w./+-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i] ?? '')) body.push(lines[i++] ?? '');
      blocks.push({ kind: 'code', lang, text: body.join('\n') });
      continue;
    }

    if (!line.trim()) { flushPara(); continue; }

    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      const level = Math.min((heading[1] ?? '#').length, 3) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: (heading[2] ?? '').trim() });
      continue;
    }

    // Table: a header row followed by a `---|---` divider.
    const next = lines[i + 1] ?? '';
    if (line.includes('|') && TABLE_DIVIDER.test(next) && next.includes('|')) {
      flushPara();
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      for (let cur = lines[i] ?? ''; i < lines.length && cur.includes('|') && cur.trim(); cur = lines[++i] ?? '') {
        rows.push(splitRow(cur));
      }
      i--;
      blocks.push({ kind: 'table', head, rows });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushPara();
      const isOrdered = !bullet;
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const m = isOrdered ? /^\s*\d+[.)]\s+(.*)$/.exec(cur) : /^\s*[-*+]\s+(.*)$/.exec(cur);
        if (!m) break;
        items.push((m[1] ?? '').trim());
        i++;
      }
      i--;
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

/**
 * Split inline markdown into emphasis runs (`**bold**`, `*italic*`, `` `code` ``).
 * Everything else is plain text; unmatched markers stay literal.
 */
export function parseInlineRuns(text: string): MdRun[] {
  const runs: MdRun[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) != null) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[2] != null) runs.push({ text: m[2], bold: true });
    else if (m[4] != null) runs.push({ text: m[4], italic: true });
    else runs.push({ text: m[5] ?? '', code: true });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text.length > 0);
}

/** Strip inline markdown to plain text (link text kept, URL dropped). */
export function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** A slide lifted out of a Slides-capability reply. */
export interface MdSlide {
  title: string;
  bullets: string[];
  /** The `Note:` line the slides prompt asks for, if present. */
  note?: string;
  /** Table rendered on the slide, when the section carried one. */
  table?: { head: string[]; rows: string[][] };
}

/**
 * Read a Slides reply into slides: one per `#`/`##` heading, its bullets, an
 * optional `Note:` speaker line, and an optional table. Content before the first
 * heading becomes the title slide's body so nothing is lost.
 */
export function parseSlides(markdown: string): MdSlide[] {
  const blocks = parseMarkdownBlocks(markdown);
  const slides: MdSlide[] = [];
  let current: MdSlide | null = null;

  const push = (title: string): MdSlide => {
    current = { title, bullets: [] };
    slides.push(current);
    return current;
  };

  for (const b of blocks) {
    if (b.kind === 'heading' && b.level <= 2) { push(stripInline(b.text)); continue; }
    const slide = current ?? push('');
    if (b.kind === 'heading') { slide.bullets.push(stripInline(b.text)); continue; }
    if (b.kind === 'list') { slide.bullets.push(...b.items.map(stripInline)); continue; }
    if (b.kind === 'table') { slide.table = { head: b.head.map(stripInline), rows: b.rows.map((r) => r.map(stripInline)) }; continue; }
    if (b.kind === 'code') continue; // diagrams/code don't render as slide text
    const note = /^note:\s*(.*)$/i.exec(b.text);
    if (note) slide.note = stripInline(note[1] ?? '');
    else slide.bullets.push(stripInline(b.text));
  }

  return slides.filter((s) => s.title || s.bullets.length || s.table);
}
