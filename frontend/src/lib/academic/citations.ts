/**
 * References, stored as FIELDS and rendered in a style — never stored pre-formatted.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * The canvas had a `sources` field on two dozen object kinds holding `{title, url}`,
 * and that is the right shape for "where did this market claim come from". It is the
 * wrong shape for scholarship, where the same work must appear as `(Rao & Diaz, 2026)`
 * in the text, as a numbered `[7]` in an IEEE paper, and as a full entry in a list
 * sorted by family name — three renderings of ONE record.
 *
 * Asking a model to "write the reference" produces a formatted string, and a formatted
 * string cannot be re-styled, re-sorted, de-duplicated or checked. A bibliography built
 * that way arrives in four styles at once and a journal rejects it. So the record holds
 * author, year, container, volume, pages and DOI as data, and the style is a pure
 * function applied at render time.
 *
 * ── WHY THE PARSERS ARE HERE AND NOT A DEPENDENCY ────────────────────────────────
 * A scholar's references already exist, in a `.bib` or `.ris` export from Zotero,
 * Mendeley, EndNote, Scopus or PubMed. Re-typing them is the reason people do not
 * adopt a new tool. Both formats are small, line-oriented and stable, and the
 * alternative — a CSL processor plus a style repository — is megabytes of dependency
 * and a network fetch per style, in a Worker-hosted app with a strict CSP.
 *
 * Six styles cover the overwhelming majority of what a university actually submits.
 * They are implemented from each style's own rules rather than approximated from one
 * template with different punctuation, because the differences that matter are
 * structural: IEEE and Vancouver NUMBER by order of appearance and initial-ise given
 * names before the family name; the author-date styles sort alphabetically and put the
 * year in a different place in every one of them.
 */

import { CITATION_STYLES, isCitationStyle, type CitationStyle, type CitationType } from '@builderforce/creation-canvas-contract';

export type { CitationStyle, CitationType };
export { CITATION_STYLES, isCitationStyle };

/**
 * One reference.
 *
 * `title` is the WORK's title, which on a `citation` canvas object is the object's own
 * title — the card is the work. `container` is the journal, book or proceedings it sat
 * inside; keeping the two apart is what lets a chapter cite its book and a paper cite
 * its journal without a second record type.
 */
export interface CitationRecord {
  key: string;
  type: CitationType;
  /** In author order, each "Family, G. I." Order is data — never re-sorted. */
  authors: string[];
  year: string;
  title: string;
  container?: string;
  publisher?: string;
  edition?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  /** Bare identifier, never a URL — see {@link normalizeDoi}. */
  doi?: string;
  url?: string;
  accessedAt?: string;
  institution?: string;
}

/** A rendered reference, in runs, so a container can be italicised accessibly rather
 *  than wrapped in markdown a screen reader reads aloud as punctuation. */
export interface CitationSegment {
  text: string;
  italic?: boolean;
}

export interface FormattedReference {
  /** Plain text — what a copy, an export and a test compare. */
  text: string;
  segments: readonly CitationSegment[];
}

const CITATION_TYPE_SET: ReadonlySet<string> = new Set<string>([
  'article-journal', 'book', 'chapter', 'paper-conference', 'thesis',
  'report', 'webpage', 'dataset', 'software', 'preprint',
]);

export function isCitationType(value: unknown): value is CitationType {
  return typeof value === 'string' && CITATION_TYPE_SET.has(value);
}

const text = (value: unknown, limit = 600): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : typeof value === 'number' ? String(value) : '';

/**
 * A DOI as the bare identifier.
 *
 * Stored bare and linked at render time, because the same DOI arrives as
 * `10.1038/x`, `doi:10.1038/x`, `https://doi.org/10.1038/x` and
 * `http://dx.doi.org/10.1038/x` from four different exporters, and a de-duplication
 * that compares those as strings finds four distinct works.
 */
export function normalizeDoi(value: unknown): string {
  const raw = text(value, 300);
  if (!raw) return '';
  const stripped = raw
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();
  return /^10\.\d{4,9}\/\S+$/.test(stripped) ? stripped : '';
}

export const doiUrl = (doi: string): string => (doi ? `https://doi.org/${doi}` : '');

/** One author, split into the two parts every style needs separately. */
export interface AuthorName {
  family: string;
  /** Given names as written — "Grace I." or "Grace Isabel". */
  given: string;
}

/**
 * Parse "Family, Given" (the stored form) and "Given Family" (what people type).
 *
 * The comma is decisive: with one, everything before it is the family name, which is
 * the only way to get "van der Berg, A." and "Ursula K. Le Guin" both right. Without
 * one, the LAST whitespace-separated token is taken as the family name — wrong for
 * some names, and the reason the stored form uses the comma.
 */
export function parseAuthorName(value: string): AuthorName {
  const raw = value.trim().replace(/\s+/g, ' ');
  if (!raw) return { family: '', given: '' };
  const comma = raw.indexOf(',');
  if (comma > 0) return { family: raw.slice(0, comma).trim(), given: raw.slice(comma + 1).trim() };
  const parts = raw.split(' ');
  if (parts.length === 1) return { family: parts[0], given: '' };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
}

/** "Grace Isabel" → "G. I."; "G.I." → "G. I." */
export function initials(given: string): string {
  const tokens = given.replace(/\./g, ' ').split(/[\s-]+/).filter(Boolean);
  return tokens.map((token) => `${token[0].toUpperCase()}.`).join(' ');
}

/** "Grace Isabel" → "GI" — Vancouver runs initials together with no stops. */
const tightInitials = (given: string): string =>
  given.replace(/\./g, ' ').split(/[\s-]+/).filter(Boolean).map((token) => token[0].toUpperCase()).join('');

export function parseAuthors(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? entry : text((entry as Record<string, unknown>)?.name)))
      .map((entry) => entry.trim()).filter(Boolean).slice(0, 60);
  }
  const raw = text(value, 4_000);
  if (!raw) return [];
  // " and " is BibTeX's separator; a semicolon is RIS's and most humans'.
  return raw.split(/\s+and\s+|;/).map((entry) => entry.trim()).filter(Boolean).slice(0, 60);
}

// ---------------------------------------------------------------------------
// Author lists, per style
// ---------------------------------------------------------------------------

/**
 * How many authors a style lists before abbreviating, and what it abbreviates to.
 * Declared as data so the six formatters below do not each re-implement "et al.".
 */
const AUTHOR_RULES: Record<CitationStyle, { max: number; etAl: string }> = {
  // APA 7 lists up to 20, then ellipsis + final author. 20 is the real rule.
  apa: { max: 20, etAl: 'et al.' },
  harvard: { max: 3, etAl: 'et al.' },
  ieee: { max: 6, etAl: 'et al.' },
  mla: { max: 2, etAl: 'et al.' },
  chicago: { max: 10, etAl: 'et al.' },
  vancouver: { max: 6, etAl: 'et al.' },
};

function authorList(authors: readonly string[], style: CitationStyle): string {
  const names = authors.map(parseAuthorName).filter((name) => name.family);
  if (!names.length) return '';
  const rule = AUTHOR_RULES[style];
  const shown = names.slice(0, rule.max);
  const truncated = names.length > rule.max;

  const rendered = shown.map((name, index) => {
    switch (style) {
      case 'apa':
        return `${name.family}, ${initials(name.given)}`.trim().replace(/,\s*$/, '');
      case 'harvard':
        return `${name.family}, ${initials(name.given).replace(/\s+/g, '')}`.trim().replace(/,\s*$/, '');
      case 'ieee':
        // IEEE puts initials FIRST: "G. I. Rao".
        return `${initials(name.given)} ${name.family}`.trim();
      case 'mla':
        // MLA inverts only the first author.
        return index === 0
          ? `${name.family}, ${name.given}`.trim().replace(/,\s*$/, '')
          : `${name.given} ${name.family}`.trim();
      case 'chicago':
        return index === 0
          ? `${name.family}, ${name.given}`.trim().replace(/,\s*$/, '')
          : `${name.given} ${name.family}`.trim();
      case 'vancouver':
        return `${name.family} ${tightInitials(name.given)}`.trim();
    }
  });

  if (style === 'vancouver') {
    return rendered.join(', ') + (truncated ? `, ${rule.etAl}` : '');
  }
  if (truncated) return `${rendered.join(', ')}, ${rule.etAl}`;
  if (rendered.length === 1) return rendered[0];

  const last = rendered[rendered.length - 1];
  const head = rendered.slice(0, -1).join(', ');
  switch (style) {
    case 'apa': return `${head}, & ${last}`;
    case 'harvard': return `${head} and ${last}`;
    case 'ieee': return rendered.length === 2 ? `${rendered[0]} and ${last}` : `${head}, and ${last}`;
    case 'mla': return rendered.length === 2 ? `${rendered[0]}, and ${last}` : `${head}, and ${last}`;
    case 'chicago': return `${head}, and ${last}`;
    default: return `${head}, ${last}`;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Build segments, dropping empties, then join with the style's own separators. */
function assemble(parts: ReadonlyArray<CitationSegment | null>): FormattedReference {
  const segments = parts.filter((part): part is CitationSegment => !!part && part.text.length > 0);
  const merged: CitationSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && !!previous.italic === !!segment.italic) previous.text += segment.text;
    else merged.push({ ...segment });
  }
  const out = merged.map((segment) => ({ ...segment, text: segment.text }));
  /**
   * A run of separators left by a missing field reads as "., ," — collapsed once here
   * rather than making every formatter defend against its own optional fields.
   *
   * A PERIOD IS NEVER DROPPED, only a comma, semicolon or colon that runs into another
   * separator, plus a doubled period. The first version of this dropped any punctuation
   * before any other, and turned "Rao, G. I., & Diaz, M." into "Rao, G. I, & Diaz, M." —
   * it ate the stop that makes an initial an initial, in every author-date style, on
   * every reference with more than one author. Hence the test that pins it.
   */
  const text = out.map((segment) => segment.text).join('')
    .replace(/\s{2,}/g, ' ')
    .replace(/([,;:])\s*(?=[.,;:])/g, '')
    .replace(/\.\s*\./g, '.')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
  return { text, segments: out };
}

const plain = (value: string): CitationSegment | null => (value ? { text: value } : null);
const italic = (value: string): CitationSegment | null => (value ? { text: value, italic: true } : null);

/** Volume/issue, which every style punctuates differently and none omits. */
function volumeIssue(record: CitationRecord, style: CitationStyle): string {
  const volume = text(record.volume, 40);
  const issue = text(record.issue, 40);
  if (!volume && !issue) return '';
  switch (style) {
    case 'ieee': return `${volume ? `vol. ${volume}` : ''}${volume && issue ? ', ' : ''}${issue ? `no. ${issue}` : ''}`;
    case 'mla': return `${volume ? `vol. ${volume}` : ''}${volume && issue ? ', ' : ''}${issue ? `no. ${issue}` : ''}`;
    case 'chicago': return `${volume}${issue ? ` (${issue})` : ''}`;
    case 'vancouver': return `${volume}${issue ? `(${issue})` : ''}`;
    default: return `${volume}${issue ? `(${issue})` : ''}`;
  }
}

function pageText(record: CitationRecord, style: CitationStyle): string {
  const pages = text(record.pages, 40);
  if (!pages) return '';
  const many = /[-–,]/.test(pages);
  switch (style) {
    case 'harvard': return `pp. ${pages}`;
    case 'ieee': return `pp. ${pages}`;
    case 'mla': return `${many ? 'pp.' : 'p.'} ${pages}`;
    default: return pages;
  }
}

const locator = (record: CitationRecord): string => {
  const doi = normalizeDoi(record.doi);
  if (doi) return doiUrl(doi);
  return text(record.url, 400);
};

/**
 * One reference, formatted.
 *
 * Each branch follows its style's own ordering rather than a shared template, because
 * the orderings genuinely differ: APA puts the year straight after the authors, MLA
 * puts it near the end, IEEE puts it last, and Vancouver runs the whole tail together
 * with semicolons and colons.
 */
export function formatReference(record: CitationRecord, style: CitationStyle): FormattedReference {
  const authors = authorList(record.authors, style);
  const year = text(record.year, 20);
  const title = text(record.title, 500);
  const container = text(record.container, 300);
  const publisher = text(record.publisher, 200) || text(record.institution, 200);
  const vi = volumeIssue(record, style);
  const pages = pageText(record, style);
  const where = locator(record);
  const accessed = text(record.accessedAt, 40);
  const isBookLike = record.type === 'book' || record.type === 'thesis' || record.type === 'report';

  switch (style) {
    case 'apa':
      return assemble([
        plain(authors ? `${authors} ` : ''),
        plain(year ? `(${year}). ` : '(n.d.). '),
        isBookLike ? italic(`${title}. `) : plain(`${title}. `),
        italic(container ? `${container}` : ''),
        plain(container && vi ? ', ' : ''),
        italic(container ? vi.replace(/\(.*\)/, '') : ''),
        plain(vi.includes('(') ? vi.slice(vi.indexOf('(')) : ''),
        plain(pages ? `, ${pages}` : ''),
        plain(container || vi || pages ? '. ' : ''),
        plain(!container && publisher ? `${publisher}. ` : ''),
        plain(where),
      ]);

    case 'harvard':
      return assemble([
        plain(authors ? `${authors} ` : ''),
        plain(`(${year || 'n.d.'}) `),
        isBookLike ? italic(`${title}. `) : plain(`'${title}', `),
        italic(container ? `${container}, ` : ''),
        plain(vi ? `${vi}, ` : ''),
        plain(pages ? `${pages}. ` : ''),
        plain(!container && publisher ? `${publisher}. ` : ''),
        plain(where ? `Available at: ${where}` : ''),
        plain(where && accessed ? ` (Accessed: ${accessed})` : ''),
      ]);

    case 'ieee':
      return assemble([
        plain(authors ? `${authors}, ` : ''),
        isBookLike ? italic(`${title}. `) : plain(`"${title}," `),
        italic(container ? `${container}, ` : ''),
        plain(vi ? `${vi}, ` : ''),
        plain(pages ? `${pages}, ` : ''),
        plain(publisher && !container ? `${publisher}, ` : ''),
        plain(year ? `${year}.` : ''),
        plain(where ? ` ${where}` : ''),
      ]);

    case 'mla':
      return assemble([
        plain(authors ? `${authors}. ` : ''),
        isBookLike ? italic(`${title}. `) : plain(`"${title}." `),
        italic(container ? `${container}, ` : ''),
        plain(vi ? `${vi}, ` : ''),
        plain(year ? `${year}, ` : ''),
        plain(pages ? `${pages}. ` : ''),
        plain(!container && publisher ? `${publisher}, ` : ''),
        plain(where),
      ]);

    case 'chicago':
      return assemble([
        plain(authors ? `${authors}. ` : ''),
        plain(year ? `${year}. ` : ''),
        isBookLike ? italic(`${title}. `) : plain(`"${title}." `),
        italic(container ? `${container} ` : ''),
        plain(vi ? `${vi}` : ''),
        plain(pages ? `: ${pages}` : ''),
        plain(container || vi || pages ? '. ' : ''),
        plain(!container && publisher ? `${publisher}. ` : ''),
        plain(where),
      ]);

    case 'vancouver':
      return assemble([
        plain(authors ? `${authors}. ` : ''),
        plain(`${title}. `),
        plain(container ? `${container}. ` : ''),
        plain(publisher && !container ? `${publisher}; ` : ''),
        plain(year ? `${year}` : ''),
        plain(vi ? `;${vi}` : ''),
        plain(pages ? `:${pages}` : ''),
        plain('.'),
        plain(where ? ` ${where}` : ''),
      ]);
  }
}

/**
 * The in-text citation — `(Rao & Diaz, 2026)` or `[7]`.
 *
 * `index` is the reference's position in the bibliography, and is what the numeric
 * styles actually print. Passing it for an author-date style is harmless, which is why
 * one signature serves both: the caller does not have to know which family it is in.
 */
export function inTextCitation(record: CitationRecord, style: CitationStyle, index = 0): string {
  if (style === 'ieee' || style === 'vancouver') return `[${index + 1}]`;
  const names = record.authors.map(parseAuthorName).filter((name) => name.family);
  const year = text(record.year, 20) || 'n.d.';
  if (!names.length) return `(${text(record.title, 40) || 'Anon.'}, ${year})`;
  const joined = names.length === 1
    ? names[0].family
    : names.length === 2
      ? `${names[0].family} ${style === 'apa' ? '&' : 'and'} ${names[1].family}`
      : `${names[0].family} et al.`;
  return style === 'mla' ? `(${joined})` : `(${joined}, ${year})`;
}

export type BibliographySort = 'author' | 'year' | 'appearance';

export function isBibliographySort(value: unknown): value is BibliographySort {
  return value === 'author' || value === 'year' || value === 'appearance';
}

/**
 * Which sort a style expects when the board has not said.
 *
 * The numeric styles are ordered by appearance because their in-text marker IS the
 * position; sorting an IEEE list alphabetically renumbers every citation in the prose.
 */
export function defaultSortFor(style: CitationStyle): BibliographySort {
  return style === 'ieee' || style === 'vancouver' ? 'appearance' : 'author';
}

export interface BibliographyEntry {
  record: CitationRecord;
  /** "[1]" for numeric styles, empty otherwise — the list's own left margin. */
  marker: string;
  formatted: FormattedReference;
}

const sortKey = (record: CitationRecord): string => {
  const first = record.authors.map(parseAuthorName).find((name) => name.family);
  return `${(first?.family ?? record.title).toLowerCase()} ${record.year}`;
};

/**
 * A whole reference list, sorted and marked.
 *
 * De-duplicates on DOI first and on `key` second: the same paper exported from two
 * databases arrives with two keys and one DOI, and a list that prints it twice is the
 * first thing a reviewer notices.
 */
export function formatBibliography(
  records: readonly CitationRecord[],
  style: CitationStyle,
  sort: BibliographySort = defaultSortFor(style),
): readonly BibliographyEntry[] {
  const seen = new Set<string>();
  const unique = records.filter((record) => {
    const identity = normalizeDoi(record.doi) || record.key || `${sortKey(record)}|${record.title}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });

  const ordered = sort === 'appearance'
    ? unique
    : [...unique].sort((left, right) => (sort === 'year'
      ? (right.year || '').localeCompare(left.year || '') || sortKey(left).localeCompare(sortKey(right))
      : sortKey(left).localeCompare(sortKey(right))));

  const numeric = style === 'ieee' || style === 'vancouver';
  return ordered.map((record, index) => ({
    record,
    marker: numeric ? `[${index + 1}]` : '',
    formatted: formatReference(record, style),
  }));
}

// ---------------------------------------------------------------------------
// Import — BibTeX and RIS
// ---------------------------------------------------------------------------

/** BibTeX entry type → our vocabulary. Anything unmapped becomes a report, which is
 *  the honest catch-all: it prints author, year, title and publisher and invents
 *  nothing. */
const BIBTEX_TYPES: Readonly<Record<string, CitationType>> = {
  article: 'article-journal', book: 'book', inbook: 'chapter', incollection: 'chapter',
  inproceedings: 'paper-conference', conference: 'paper-conference', proceedings: 'paper-conference',
  phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report', manual: 'report',
  misc: 'webpage', online: 'webpage', electronic: 'webpage', dataset: 'dataset', software: 'software',
};

/** Strip the braces and the commonest TeX escapes a title arrives wrapped in. */
function debrace(value: string): string {
  return value
    .replace(/^[{"]+|[}"]+$/g, '')
    .replace(/\{\\['`^"~=.]\{?([A-Za-z])\}?\}/g, '$1')
    .replace(/\{\\(ss|aa|oe|ae)\}/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\\&/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a `.bib` file.
 *
 * Brace-depth scanning rather than a regex per field, because a BibTeX value legally
 * contains commas, quotes and nested braces — `title = {A study of {DNA} repair, in
 * vivo}` is one field, and a comma-splitting parser turns it into three broken ones.
 */
export function parseBibtex(source: string): CitationRecord[] {
  const records: CitationRecord[] = [];
  const input = String(source ?? '');
  const entry = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
  let match: RegExpExecArray | null;

  while ((match = entry.exec(input)) !== null) {
    const type = BIBTEX_TYPES[match[1].toLowerCase()] ?? 'report';
    const key = match[2].trim();
    // Walk to the entry's closing brace, tracking depth.
    let depth = 1;
    let cursor = entry.lastIndex;
    while (cursor < input.length && depth > 0) {
      if (input[cursor] === '{') depth += 1;
      else if (input[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const body = input.slice(entry.lastIndex, cursor - 1);
    const fields = new Map<string, string>();

    let position = 0;
    while (position < body.length) {
      const assign = /([A-Za-z-]+)\s*=\s*/g;
      assign.lastIndex = position;
      const found = assign.exec(body);
      if (!found) break;
      let valueStart = assign.lastIndex;
      let value = '';
      if (body[valueStart] === '{' || body[valueStart] === '"') {
        const open = body[valueStart];
        const close = open === '{' ? '}' : '"';
        let level = 1;
        let scan = valueStart + 1;
        while (scan < body.length && level > 0) {
          if (open === '{' && body[scan] === '{') level += 1;
          else if (body[scan] === close) level -= 1;
          if (level > 0) scan += 1;
        }
        value = body.slice(valueStart + 1, scan);
        position = scan + 1;
      } else {
        const comma = body.indexOf(',', valueStart);
        const end = comma === -1 ? body.length : comma;
        value = body.slice(valueStart, end);
        position = end + 1;
      }
      fields.set(found[1].toLowerCase(), debrace(value));
    }

    const get = (...names: string[]): string => {
      for (const name of names) { const value = fields.get(name); if (value) return value; }
      return '';
    };
    const title = get('title');
    if (!title && !key) continue;
    records.push({
      key: key || title.slice(0, 40),
      type,
      authors: parseAuthors(get('author', 'editor')),
      year: get('year', 'date').slice(0, 4),
      title,
      container: get('journal', 'journaltitle', 'booktitle', 'series') || undefined,
      publisher: get('publisher') || undefined,
      edition: get('edition') || undefined,
      volume: get('volume') || undefined,
      issue: get('number', 'issue') || undefined,
      pages: get('pages').replace(/--/g, '–') || undefined,
      doi: normalizeDoi(get('doi')) || undefined,
      url: get('url', 'howpublished') || undefined,
      accessedAt: get('urldate') || undefined,
      institution: get('institution', 'school', 'organization') || undefined,
    });
  }
  return records.slice(0, 2_000);
}

/** RIS tag → our vocabulary. */
const RIS_TYPES: Readonly<Record<string, CitationType>> = {
  JOUR: 'article-journal', BOOK: 'book', CHAP: 'chapter', CONF: 'paper-conference',
  CPAPER: 'paper-conference', THES: 'thesis', RPRT: 'report', ELEC: 'webpage',
  DATA: 'dataset', COMP: 'software', UNPB: 'preprint', GEN: 'report',
};

/**
 * Parse a `.ris` file.
 *
 * RIS repeats a tag per value (`AU  - ` once per author) and ends a record with
 * `ER  -`, so the parser accumulates rather than assigns — the single most common bug
 * in hand-rolled RIS readers is keeping only the last author.
 */
export function parseRis(source: string): CitationRecord[] {
  const records: CitationRecord[] = [];
  let current: Record<string, string[]> | null = null;

  for (const rawLine of String(source ?? '').split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const match = /^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/.exec(line);
    if (!match) {
      // A wrapped continuation line belongs to the previous tag.
      if (current && line.trim() && current.__last?.length) {
        const tag = current.__last[0];
        const bucket = current[tag];
        if (bucket?.length) bucket[bucket.length - 1] += ` ${line.trim()}`;
      }
      continue;
    }
    const [, tag, value] = match;
    if (tag === 'TY') { current = { TY: [value.trim()], __last: ['TY'] }; continue; }
    if (!current) continue;
    if (tag === 'ER') {
      const get = (name: string): string => (current?.[name]?.[0] ?? '').trim();
      const all = (name: string): string[] => current?.[name] ?? [];
      const title = get('TI') || get('T1') || get('BT');
      if (title) {
        const startYear = get('PY') || get('Y1') || get('DA');
        records.push({
          key: (get('ID') || title.slice(0, 40)).trim(),
          type: RIS_TYPES[get('TY').toUpperCase()] ?? 'report',
          authors: [...all('AU'), ...all('A1'), ...all('A2')].map((entry) => entry.trim()).filter(Boolean),
          year: (startYear.match(/\d{4}/)?.[0] ?? ''),
          title,
          container: get('JO') || get('JF') || get('T2') || undefined,
          publisher: get('PB') || undefined,
          volume: get('VL') || undefined,
          issue: get('IS') || undefined,
          pages: get('SP') && get('EP') ? `${get('SP')}–${get('EP')}` : get('SP') || undefined,
          doi: normalizeDoi(get('DO')) || undefined,
          url: get('UR') || undefined,
          accessedAt: get('Y2') || undefined,
          institution: get('AD') || undefined,
        });
      }
      current = null;
      continue;
    }
    current[tag] = [...(current[tag] ?? []), value.trim()];
    current.__last = [tag];
  }
  return records.slice(0, 2_000);
}

/** Detect and parse either format, so one import action serves both. */
export function parseReferences(source: string): CitationRecord[] {
  const raw = String(source ?? '');
  if (/^\s*TY\s{2}-/m.test(raw)) return parseRis(raw);
  if (/@\w+\s*\{/.test(raw)) return parseBibtex(raw);
  return [];
}

const bibtexEscape = (value: string): string => value.replace(/([&%$#_])/g, '\\$1');

const TO_BIBTEX: Readonly<Record<CitationType, string>> = {
  'article-journal': 'article', book: 'book', chapter: 'incollection',
  'paper-conference': 'inproceedings', thesis: 'phdthesis', report: 'techreport',
  webpage: 'misc', dataset: 'misc', software: 'misc', preprint: 'misc',
};

/** Serialise back to `.bib`, so a board's references leave as easily as they arrived. */
export function toBibtex(records: readonly CitationRecord[]): string {
  return records.map((record) => {
    const fields: Array<[string, string]> = [
      ['author', record.authors.join(' and ')],
      ['title', record.title],
      ['year', record.year],
      [record.type === 'paper-conference' || record.type === 'chapter' ? 'booktitle' : 'journal', record.container ?? ''],
      ['publisher', record.publisher ?? ''],
      ['volume', record.volume ?? ''],
      ['number', record.issue ?? ''],
      ['pages', (record.pages ?? '').replace(/–/g, '--')],
      ['doi', record.doi ?? ''],
      ['url', record.url ?? ''],
      ['school', record.type === 'thesis' ? record.institution ?? '' : ''],
      ['institution', record.type === 'report' ? record.institution ?? '' : ''],
    ];
    const body = fields
      .filter(([, value]) => value)
      .map(([name, value]) => `  ${name} = {${bibtexEscape(value)}}`)
      .join(',\n');
    return `@${TO_BIBTEX[record.type]}{${record.key || 'ref'},\n${body}\n}`;
  }).join('\n\n');
}

// ---------------------------------------------------------------------------
// Canvas adapters — node data in, records out
// ---------------------------------------------------------------------------

/** Read a `citation` object's fields as a record. */
export function citationFromNode(data: Readonly<Record<string, unknown>>): CitationRecord {
  const doi = normalizeDoi(data.doi);
  return {
    key: text(data.citationKey, 120) || text(data.title, 40),
    type: isCitationType(data.citationType) ? data.citationType : 'article-journal',
    authors: parseAuthors(data.authors),
    year: text(data.year, 20),
    title: text(data.title, 500),
    container: text(data.container, 300) || undefined,
    publisher: text(data.publisher, 200) || undefined,
    volume: text(data.volume, 40) || undefined,
    issue: text(data.issue, 40) || undefined,
    pages: text(data.pages, 40) || undefined,
    doi: doi || undefined,
    url: text(data.url, 400) || undefined,
    accessedAt: text(data.accessedAt, 40) || undefined,
  };
}

/**
 * Read a `bibliography` object's rows as records.
 *
 * The row carries `workTitle` rather than `title` for one reason: a table row rendered
 * by the generic body reads its columns by name, and a column called `title` would be
 * confused with the OBJECT's title on every surface that projects a row.
 */
export function citationsFromBibliographyNode(data: Readonly<Record<string, unknown>>): CitationRecord[] {
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries.slice(0, 1_000).flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const title = text(row.workTitle, 500) || text(row.title, 500);
    if (!title) return [];
    return [{
      key: text(row.citationKey, 120) || title.slice(0, 40),
      type: isCitationType(row.citationType) ? row.citationType : 'article-journal',
      authors: parseAuthors(row.authors),
      year: text(row.year, 20),
      title,
      container: text(row.container, 300) || undefined,
      publisher: text(row.publisher, 200) || undefined,
      volume: text(row.volume, 40) || undefined,
      issue: text(row.issue, 40) || undefined,
      pages: text(row.pages, 40) || undefined,
      doi: normalizeDoi(row.doi) || undefined,
      url: text(row.url, 400) || undefined,
    }];
  });
}

/** The style an object asks for, falling back to APA — the most common default in
 *  teaching, and never a silent per-object guess. */
export function citationStyleOf(data: Readonly<Record<string, unknown>>): CitationStyle {
  return isCitationStyle(data.citationStyle) ? data.citationStyle : 'apa';
}
