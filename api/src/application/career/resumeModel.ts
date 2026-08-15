/**
 * The parsed shape of a résumé, and the parser that produces it from plain text.
 *
 * ── WHY A PARSER AND NOT A SCHEMA ────────────────────────────────────────────────
 * Every other tool in this domain needs the same three things: the bullets (to judge
 * how they are written), the dates (to judge format consistency and tenure), and the
 * contact block (to judge completeness). Written per-tool, each would re-split the text
 * differently and the tools would disagree about the same document — the scorer marking
 * a bullet the optimizer cannot find.
 *
 * The parser is deliberately tolerant. A résumé arrives as whatever the person pasted:
 * a PDF text dump with broken line-wrapping, a Markdown export, or a Word paste with
 * bullet glyphs. It never rejects — a document it cannot section still yields bullets
 * and words, and every consumer degrades to "we scored what we could read" rather than
 * refusing to answer, because refusing is the one outcome that helps nobody.
 */

import { STRONG_VERBS, WEAK_OPENERS, canonicalize, isSkillToken, tokenSet } from './lexicon';

/** A canonical résumé section. Unknown headings collapse to `other`. */
export type ResumeSectionKind =
  | 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'other';

export interface ResumeBullet {
  /** The bullet text with its glyph and surrounding whitespace removed. */
  text: string;
  /** Section this bullet was found under. */
  section: ResumeSectionKind;
  /** First word, lowercased — what the bullet leads with. */
  opener: string;
  /** True when the opener is one of the ownership verbs. */
  strongOpener: boolean;
  /** The weak opener matched, when the bullet describes presence rather than result. */
  weakOpener: string | null;
  /** True when the bullet contains a number, percentage, or currency amount. */
  quantified: boolean;
  /** Character length — long bullets wrap to three lines and stop being scanned. */
  length: number;
}

export interface ResumeDateRange {
  /** The raw text as written, e.g. "Jan 2021 – Present". */
  raw: string;
  /** Normalised `YYYY-MM` start, or null when unparseable. */
  start: string | null;
  /** Normalised `YYYY-MM` end, `'Present'` for open-ended, or null. */
  end: string | null;
  /** The format family this range was written in — used to detect inconsistency. */
  style: 'iso' | 'monthYear' | 'yearOnly' | 'slash' | 'unknown';
}

export interface ParsedResume {
  /** The original text, normalised for line endings and bullet glyphs. */
  text: string;
  wordCount: number;
  /** Sections found, in document order. */
  sections: Array<{ kind: ResumeSectionKind; heading: string; body: string }>;
  bullets: ResumeBullet[];
  dates: ResumeDateRange[];
  contact: {
    email: string | null;
    phone: string | null;
    /** Any http(s) link found — portfolio, GitHub, LinkedIn. */
    links: string[];
    hasLinkedIn: boolean;
  };
  /** Canonical skill tokens detected anywhere in the document. */
  skillTokens: string[];
  /** Every canonical token, for keyword comparison. */
  tokens: string[];
}

const SECTION_PATTERNS: ReadonlyArray<readonly [ResumeSectionKind, RegExp]> = [
  ['summary', /^(professional\s+)?(summary|profile|objective|about( me)?|overview)\b/i],
  ['experience', /^(work\s+|professional\s+|relevant\s+)?(experience|employment|history|career)\b/i],
  ['education', /^(education|academic|qualifications|training)\b/i],
  ['skills', /^(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|expertise|proficiencies)\b/i],
  ['projects', /^(projects|portfolio|selected work|open source)\b/i],
  ['certifications', /^(certifications?|licen[cs]es?|awards?|accreditations?)\b/i],
];

/** Bullet glyphs people paste out of Word, Google Docs and PDFs. */
const BULLET_GLYPH = /^[\s]*[-–—•·▪◦*‣⁃o]\s+/;

/**
 * Date ranges, in the four families résumés actually use. Ordered most-specific first
 * so `2021-03` is read as ISO rather than as a bare year followed by punctuation.
 */
const DATE_PATTERNS: ReadonlyArray<readonly [ResumeDateRange['style'], RegExp]> = [
  ['iso', /\b(\d{4}-\d{2}(?:-\d{2})?)\s*[–—\-to]+\s*(\d{4}-\d{2}(?:-\d{2})?|present|current)\b/gi],
  ['slash', /\b(\d{1,2}\/\d{4})\s*[–—\-to]+\s*(\d{1,2}\/\d{4}|present|current)\b/gi],
  ['monthYear', /\b([A-Z][a-z]{2,8}\.?\s+\d{4})\s*[–—\-to]+\s*([A-Z][a-z]{2,8}\.?\s+\d{4}|present|current)\b/gi],
  ['yearOnly', /\b(\d{4})\s*[–—\-to]+\s*(\d{4}|present|current)\b/gi],
];

const MONTHS: Readonly<Record<string, string>> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Normalise one date token to `YYYY-MM`, `'Present'`, or null.
 *
 * Accepts `undefined` because the scanners below run several regex families with
 * DIFFERENT group counts over the same text — a range pattern has an end group and
 * a single-date pattern does not. "No such group" and "unparseable" are the same
 * answer here, so it is given once rather than guarded at each of the two callers.
 */
export function normalizeDateToken(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^(present|current)$/i.test(value)) return 'Present';
  const iso = value.match(/^(\d{4})-(\d{2})/);
  if (iso?.[1] && iso[2]) return `${iso[1]}-${iso[2]}`;
  const slash = value.match(/^(\d{1,2})\/(\d{4})$/);
  if (slash?.[1] && slash[2]) return `${slash[2]}-${slash[1].padStart(2, '0')}`;
  const monthYear = value.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (monthYear?.[1] && monthYear[2]) {
    const month = MONTHS[monthYear[1].slice(0, 3).toLowerCase()];
    if (month) return `${monthYear[2]}-${month}`;
  }
  const yearOnly = value.match(/^(\d{4})$/);
  if (yearOnly?.[1]) return `${yearOnly[1]}-01`;
  return null;
}

/**
 * The first date RANGE in one line, or null.
 *
 * Exported because two readers need the same answer about the same line: `parseResume`
 * scans the whole document for tenure analysis, and `resumeDocument.ts` uses a date
 * range as the ANCHOR that says "an employment entry starts here". Written twice, the
 * scorer and the document builder would disagree about where a job began.
 */
export function matchDateRange(line: string): ResumeDateRange | null {
  for (const [style, pattern] of DATE_PATTERNS) {
    // A fresh RegExp per call: the module-level literals carry /g state.
    const match = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(line);
    if (match) {
      return { raw: match[0], start: normalizeDateToken(match[1]), end: normalizeDateToken(match[2]), style };
    }
  }
  return null;
}

function classifyHeading(line: string): ResumeSectionKind | null {
  const trimmed = line.replace(/[#*_:]/g, '').trim();
  if (!trimmed || trimmed.length > 60) return null;
  // A heading is short, and is either title-case/upper-case or ends with a colon.
  const looksLikeHeading = /^[A-Z0-9]/.test(trimmed) && trimmed.split(/\s+/).length <= 5;
  if (!looksLikeHeading) return null;
  for (const [kind, pattern] of SECTION_PATTERNS) {
    if (pattern.test(trimmed)) return kind;
  }
  return null;
}

/** Parse plain résumé text into the shared structure every career tool reads. */
export function parseResume(input: string): ParsedResume {
  const text = String(input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .trim();
  const lines = text.split('\n');

  // ── Sections ──────────────────────────────────────────────────────────────────
  const sections: ParsedResume['sections'] = [];
  let current: { kind: ResumeSectionKind; heading: string; body: string[] } = {
    kind: 'other', heading: '', body: [],
  };
  for (const line of lines) {
    const kind = classifyHeading(line);
    if (kind) {
      if (current.body.length || current.heading) {
        sections.push({ kind: current.kind, heading: current.heading, body: current.body.join('\n') });
      }
      current = { kind, heading: line.trim(), body: [] };
      continue;
    }
    current.body.push(line);
  }
  if (current.body.length || current.heading) {
    sections.push({ kind: current.kind, heading: current.heading, body: current.body.join('\n') });
  }

  /** Which section a given line index falls under — bullets carry their section. */
  const sectionForLine = (line: string): ResumeSectionKind => {
    for (const section of sections) {
      if (section.body.includes(line)) return section.kind;
    }
    return 'other';
  };

  // ── Bullets ───────────────────────────────────────────────────────────────────
  const bullets: ResumeBullet[] = [];
  for (const line of lines) {
    if (!BULLET_GLYPH.test(line)) continue;
    const bulletText = line.replace(BULLET_GLYPH, '').trim();
    if (bulletText.length < 8) continue;
    const lower = bulletText.toLowerCase();
    const opener = canonicalize(bulletText.split(/\s+/)[0] ?? '');
    bullets.push({
      text: bulletText,
      section: sectionForLine(line),
      opener,
      strongOpener: STRONG_VERBS.includes(opener),
      weakOpener: WEAK_OPENERS.find((weak) => lower.startsWith(weak)) ?? null,
      quantified: /\d/.test(bulletText) && /(\d+\s*%|\$\s*\d|\d+\s*(x|k|m|bn|hrs?|hours?|days?|weeks?|months?|users?|customers?|people|engineers?|clients?)|\b\d{2,}\b)/i.test(bulletText),
      length: bulletText.length,
    });
  }

  // ── Dates ─────────────────────────────────────────────────────────────────────
  const dates: ResumeDateRange[] = [];
  const claimed = new Set<string>();
  for (const [style, pattern] of DATE_PATTERNS) {
    // A fresh RegExp per parse: the module-level literals carry /g state.
    const scanner = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(text)) !== null) {
      if (claimed.has(match[0])) continue;
      // A more specific family already claimed this span (ISO before yearOnly).
      if ([...claimed].some((seen) => seen.includes(match![0]))) continue;
      claimed.add(match[0]);
      dates.push({
        raw: match[0],
        start: normalizeDateToken(match[1]),
        end: normalizeDateToken(match[2]),
        style,
      });
    }
  }

  // ── Contact ───────────────────────────────────────────────────────────────────
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
  const phone = text.match(/(\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() ?? null;
  const links = [...new Set(Array.from(text.matchAll(/https?:\/\/[^\s)>\]]+/g), (m) => m[0]))];

  const tokens = tokenSet(text);
  return {
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    sections,
    bullets,
    dates,
    contact: {
      email,
      phone,
      links,
      hasLinkedIn: /linkedin\.com\//i.test(text),
    },
    skillTokens: tokens.filter(isSkillToken),
    tokens,
  };
}

/** True when a parsed document has too little content to score honestly. */
export function isTooShortToScore(parsed: ParsedResume): boolean {
  return parsed.wordCount < 40;
}
