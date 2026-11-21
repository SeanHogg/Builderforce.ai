/**
 * The ROADMAP gap register, as data.
 *
 * `ROADMAP.md`'s "Consolidated Gap Register" is the list of outstanding work: one
 * top-level bullet per gap, grouped by stage of the arc (`## 💡 Idea …`, `## 🔨 Make …`)
 * and optionally by a `###` sub-group carrying tags (`` `[agents]` ``). A gap reads
 *
 *   - **[tag] Summary,** body … [make.md › Section](./docs/specs/make.md#anchor) *Blocker: …*
 *
 * and may carry indented sub-bullets, which belong to it. Before this module there was
 * no parser anywhere, so "is every open ticket backed by a gap?" meant a model reading
 * 600 roadmap lines by hand — one gave up after 106.
 *
 * Also here: the GitHub heading-anchor rule ({@link parseSpecAnchors}), so a gap's spec
 * link can be checked against the headings that actually exist in the spec.
 *
 * Pure: strings in, data out. No I/O.
 */

export interface GapSpecLink {
  /** The linked file as written, relative to the roadmap, leading `./` removed. */
  file: string;
  /** The `#fragment`, or null for a link to the whole file. */
  anchor: string | null;
}

export interface GapEntry {
  /** `${stage}/${slug of summary}` — stable while the stage and summary are; a repeated
   *  summary within a stage gets `-2`, `-3`, … in document order. */
  id: string;
  /** First word of the `##` stage heading, lowercased: idea, make, run, measure, reach, other. */
  stage: string;
  /** The `###` sub-group heading (tags removed), or null directly under the stage. */
  group: string | null;
  /** The bold `[tag]`s first, then the sub-group's tags; deduplicated. */
  tags: string[];
  summary: string;
  body: string;
  blocker: string | null;
  specLinks: GapSpecLink[];
  /** 1-based line of the gap's bullet. */
  line: number;
}

/** The heading the register starts at; everything above it is preamble. */
const REGISTER_HEADING = /^##\s+Consolidated Gap Register\b/i;
const FENCE = /^\s*(```|~~~)/;
const TAG = /\[([^\]\s][^\]]*)\]/g;
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const MAX_SLUG = 80;

/** Lowercase, alphanumerics joined by single hyphens, capped; `fallback` when nothing is left.
 *  THE slug of a register gap and of a spec's open item (`specOpenItems.ts`). */
export function specSlug(text: string, fallback = 'gap'): string {
  const slug = text
    .toLowerCase()
    .replace(/[`*]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, MAX_SLUG).replace(/-+$/, '') || fallback;
}

function stageOf(heading: string): string {
  const word = heading.replace(/^#+\s*/, '').match(/[A-Za-z][A-Za-z0-9]*/);
  return word ? word[0].toLowerCase() : 'unknown';
}

function tagsIn(text: string): string[] {
  return [...text.matchAll(TAG)].map((m) => m[1]!.trim()).filter(Boolean);
}

/** A percent-encoded fragment decoded; a malformed one (`#100%`) is kept as written. */
function decodeAnchor(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Relative markdown links (`.md`, optionally `#anchor`); web links are not spec links. */
function specLinksIn(text: string): GapSpecLink[] {
  const out: GapSpecLink[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(LINK)) {
    const href = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    const hash = href.indexOf('#');
    const path = (hash >= 0 ? href.slice(0, hash) : href).replace(/^\.\//, '');
    if (!/\.md$/i.test(path)) continue;
    const anchor = hash >= 0 ? decodeAnchor(href.slice(hash + 1)) || null : null;
    const key = `${path}#${anchor ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: path, anchor });
  }
  return out;
}

interface OpenGap {
  line: number;
  head: string;
  rest: string[];
  stage: string;
  group: string | null;
  groupTags: string[];
}

/** One gap from its bullet line (without `- `) and continuation lines. */
function toEntry(open: OpenGap): Omit<GapEntry, 'id'> {
  const bold = open.head.match(/^\*\*(.+?)\*\*(.*)$/);
  let summarySource: string;
  let bodyHead: string;
  if (bold) {
    summarySource = bold[1]!;
    bodyHead = bold[2]!;
  } else {
    // No bold lead: the first sentence stands in for the summary.
    const sentence = open.head.match(/^(.+?[.!?])(\s+.*)?$/);
    summarySource = sentence ? sentence[1]! : open.head;
    bodyHead = sentence?.[2] ?? '';
  }
  const leadTags: string[] = [];
  let summary = summarySource.trim();
  for (let m = summary.match(/^\[([^\]]+)\]\s*/); m; m = summary.match(/^\[([^\]]+)\]\s*/)) {
    leadTags.push(m[1]!.trim());
    summary = summary.slice(m[0].length);
  }
  summary = summary.replace(/[\s,.;:]+$/, '').trim();
  const body = [bodyHead.trim(), ...open.rest].join('\n').trim();
  const all = `${open.head}\n${open.rest.join('\n')}`;
  // Up to the `*` that closes the italic span, so a blocker may itself contain `*`.
  const blocker = all.match(/\*Blocker:\s*(.+?)\*(?=\s|$)/im);
  return {
    stage: open.stage,
    group: open.group,
    tags: [...new Set([...leadTags, ...open.groupTags])],
    summary,
    body,
    blocker: blocker ? blocker[1]!.replace(/[.\s]+$/, '') : null,
    specLinks: specLinksIn(all),
    line: open.line,
  };
}

/**
 * Every gap of the register, in document order. A document without the register
 * heading yields `[]`.
 */
export function parseGapRegister(markdown: string): GapEntry[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => REGISTER_HEADING.test(l));
  if (start < 0) return [];

  const entries: Array<Omit<GapEntry, 'id'>> = [];
  let stage: string | null = null;
  let group: string | null = null;
  let groupTags: string[] = [];
  let open: OpenGap | null = null;
  let afterBlank = false;
  let inFence = false;

  const close = () => {
    if (open) entries.push(toEntry(open));
    open = null;
  };

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.test(line);
    if (fence) inFence = !inFence;
    if (fence || inFence) {
      if (open) (open as OpenGap).rest.push(line);
      continue;
    }
    if (/^##\s/.test(line)) {
      close();
      stage = stageOf(line);
      group = null;
      groupTags = [];
      continue;
    }
    if (/^###\s/.test(line)) {
      close();
      const text = line.replace(/^###\s+/, '');
      groupTags = tagsIn(text.match(/`[^`]*`/g)?.join(' ') ?? '');
      group = text.replace(/`\[[^\]]*\]`/g, '').replace(/\s+/g, ' ').trim() || null;
      continue;
    }
    if (/^#{4,}\s/.test(line) || /^(-{3,}|\*{3,})\s*$/.test(line)) {
      close();
      continue;
    }
    if (line.trim() === '') {
      afterBlank = true;
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet && stage) {
      close();
      open = { line: i + 1, head: bullet[1]!.trim(), rest: [], stage, group, groupTags };
      afterBlank = false;
      continue;
    }
    // Continuation: an indented line always; an unindented one only before a blank line.
    if (open && (/^\s/.test(line) || !afterBlank)) {
      (open as OpenGap).rest.push(line.trim());
    } else {
      close();
    }
    afterBlank = false;
  }
  close();

  const used = new Map<string, number>();
  return entries
    .filter((e) => e.summary !== '')
    .map((e) => {
      const base = `${e.stage}/${specSlug(e.summary)}`;
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      return { id: n === 1 ? base : `${base}-${n}`, ...e };
    });
}

/**
 * GitHub's heading anchor for `text`: inline markup unwrapped, lowercased, everything
 * but letters, marks, numbers, `_`, `-` and spaces removed (so emoji and punctuation
 * go), spaces turned into `-`. Exported for callers that build links.
 */
export function githubHeadingSlug(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/**
 * Every anchor a markdown file exposes on GitHub: one per ATX heading (a repeated slug
 * gets `-1`, `-2`, …), plus explicit `<a id|name="…">` anchors. Headings inside fenced
 * code blocks are not headings.
 */
export function parseSpecAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const m of line.matchAll(/<a\s+[^>]*(?:id|name)\s*=\s*["']([^"']+)["']/gi)) anchors.add(m[1]!);
    const heading = line.match(/^ {0,3}#{1,6}\s+(.*?)(?:\s+#+\s*)?$/);
    if (!heading) continue;
    const slug = githubHeadingSlug(heading[1]!);
    const seen = counts.get(slug);
    counts.set(slug, (seen ?? -1) + 1);
    anchors.add(seen === undefined ? slug : `${slug}-${seen + 1}`);
  }
  return anchors;
}
