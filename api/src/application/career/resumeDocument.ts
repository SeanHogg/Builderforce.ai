/**
 * Plain résumé text → a structured JSON Resume document, with no model involved.
 *
 * ── WHY DETERMINISTIC ────────────────────────────────────────────────────────────
 * `POST /api/creative/resume/import` structures a résumé by asking a multimodal model.
 * That is the right tool for a SCAN — a photographed CV with no text layer — and the
 * wrong one for the common case, where the file already contains its own text. Reading
 * that with a model costs tokens per upload, needs a tenant with plan-resolved proxy
 * credentials, and returns nothing when the provider is down.
 *
 * So this runs first and the model is the fallback. It is also the only path available
 * to the tenantless for-hire upload, which is the one flow that MUST work on day one.
 *
 * ── WHY IT REUSES `parseResume` RATHER THAN PORTING A SECOND PARSER ──────────────
 * hired.video's `parseResumeWithRegex` is a separate 400-line reader with its own
 * sectioniser. Porting it would give this codebase two parsers that disagree about the
 * same document — the scorer finding a bullet the document builder dropped. (It also
 * hard-codes its author's own first name into a heading heuristic, which is exactly the
 * kind of thing a second copy preserves forever.) `parseResume` already sections text,
 * classifies bullets and detects contact details; this adds only what it lacks, which
 * is grouping an experience section into DATED ENTRIES.
 *
 * Pure: no DB, no network, no clock, no env — same rule as the rest of `career/`.
 */
import type {
  CanvasResumeDocument,
  CanvasResumeEducation,
  CanvasResumeSkill,
  CanvasResumeWork,
} from '@builderforce/creation-canvas-contract';
import { matchDateRange, parseResume, type ParsedResume, type ResumeSectionKind } from './resumeModel';

/** Bullet glyphs, matching the set `parseResume` strips. */
const BULLET_GLYPH = /^\s*[-–—•·▪◦*‣⁃]\s+/;
/** Running heads and page numbers, which otherwise become phantom entry titles. */
const PAGE_FURNITURE = /^(page\s+\d+(\s+of\s+\d+)?|\d+\s*\/\s*\d+|-\s*\d+\s*-)$/i;
/** Separators résumés use to pack two facts onto one line: "Acme | Senior Engineer". */
const INLINE_SEPARATOR = /\s+[|▪•·—–]\s+|\s{3,}/;

const isBullet = (line: string): boolean => BULLET_GLYPH.test(line);
const stripBullet = (line: string): string => line.replace(BULLET_GLYPH, '').trim();

/** Lines of a section, cleaned of blank lines and page furniture. */
function sectionLines(parsed: ParsedResume, kind: ResumeSectionKind): string[] {
  return parsed.sections
    .filter((section) => section.kind === kind)
    .flatMap((section) => section.body.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !PAGE_FURNITURE.test(line));
}

/**
 * One dated entry: the date line, the heading lines above it, and the bullets below.
 *
 * Résumés put the date in three places — on the heading line, on the line after it, or
 * on the line before it — so the anchor is the DATE and the heading is found relative
 * to it, rather than assuming a fixed line order that only one layout satisfies.
 */
interface DatedEntry {
  headings: string[];
  startDate: string | null;
  endDate: string | null;
  bullets: string[];
}

function groupDatedEntries(lines: string[]): DatedEntry[] {
  const entries: DatedEntry[] = [];
  /** Heading lines seen since the last entry was opened. */
  let pending: string[] = [];

  for (const line of lines) {
    const range = matchDateRange(line);
    const bullet = isBullet(line);

    if (bullet) {
      // A bullet before any dated entry belongs to nothing; drop it rather than
      // inventing an entry with no employer.
      if (entries.length > 0) entries[entries.length - 1]!.bullets.push(stripBullet(line));
      continue;
    }

    if (range) {
      // The date may share its line with the heading ("Acme — Engineer, 2019–2022").
      const inlineHeading = line.replace(range.raw, '').replace(/[,;|▪•·—–]\s*$/, '').trim();
      const headings = [...pending, ...(inlineHeading.length > 1 ? [inlineHeading] : [])];
      entries.push({ headings, startDate: range.start, endDate: range.end, bullets: [] });
      pending = [];
      continue;
    }

    // A plain line: a heading for the NEXT entry, or a continuation of the last one's
    // prose. Two pending headings is the most any layout uses (title + employer), so a
    // third means the previous ones were prose and should not become a job title.
    pending.push(line);
    if (pending.length > 2) pending = pending.slice(-2);
  }
  return entries;
}

/**
 * Split a heading block into (organisation, role).
 *
 * Order is genuinely ambiguous across résumés, so this does not guess by position — it
 * uses the one signal that is reliable: role words appear in titles, not in company
 * names. When neither line looks like a title, the first is treated as the employer,
 * which is the more common layout and the less damaging error (a wrong employer reads
 * as a typo; a wrong job title reads as a lie).
 */
const ROLE_WORDS = /\b(engineer|developer|manager|director|designer|analyst|consultant|lead|architect|scientist|specialist|coordinator|administrator|officer|president|founder|intern|associate|assistant|head|chief|vp|cto|ceo|cfo|coo|principal|senior|junior|staff|supervisor|technician|nurse|teacher|writer|editor|producer|recruiter|accountant|attorney|paralegal|therapist|advisor|strategist|partner)\b/i;

function splitHeadings(headings: string[]): { organisation: string; role: string } {
  const parts = headings
    .flatMap((heading) => heading.split(INLINE_SEPARATOR))
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && part.length <= 160);
  if (parts.length === 0) return { organisation: '', role: '' };
  if (parts.length === 1) {
    const only = parts[0]!;
    return ROLE_WORDS.test(only) ? { organisation: '', role: only } : { organisation: only, role: '' };
  }
  const roleIndex = parts.findIndex((part) => ROLE_WORDS.test(part));
  if (roleIndex === -1) return { organisation: parts[0]!, role: parts[1]! };
  const role = parts[roleIndex]!;
  const organisation = parts.find((part, index) => index !== roleIndex) ?? '';
  return { organisation, role };
}

/** Degree/field words that mark the "role" half of an education heading. */
const STUDY_WORDS = /\b(b\.?s\.?c?|m\.?s\.?c?|m\.?b\.?a|ph\.?d|b\.?a|m\.?a|bachelor|master|doctorate|diploma|certificate|associate|degree|honours|honors)\b/i;

function toWork(entries: DatedEntry[]): CanvasResumeWork[] {
  return entries.map((entry, index) => {
    const { organisation, role } = splitHeadings(entry.headings);
    return {
      id: `work-${index + 1}`,
      name: organisation,
      position: role,
      ...(entry.startDate ? { startDate: entry.startDate } : {}),
      ...(entry.endDate ? { endDate: entry.endDate } : {}),
      ...(entry.bullets.length ? { highlights: entry.bullets } : {}),
    } satisfies CanvasResumeWork;
  }).filter((work) => Boolean(work.name || work.position));
}

function toEducation(entries: DatedEntry[]): CanvasResumeEducation[] {
  return entries.map((entry, index) => {
    const parts = entry.headings
      .flatMap((heading) => heading.split(INLINE_SEPARATOR))
      .map((part) => part.trim())
      .filter((part) => part.length > 1);
    const studyIndex = parts.findIndex((part) => STUDY_WORDS.test(part));
    const studyType = studyIndex === -1 ? '' : parts[studyIndex]!;
    const institution = parts.find((part, i) => i !== studyIndex) ?? '';
    return {
      id: `education-${index + 1}`,
      institution,
      ...(studyType ? { studyType } : {}),
      ...(entry.startDate ? { startDate: entry.startDate } : {}),
      ...(entry.endDate ? { endDate: entry.endDate } : {}),
      ...(entry.bullets.length ? { courses: entry.bullets } : {}),
    } satisfies CanvasResumeEducation;
  }).filter((education) => Boolean(education.institution || education.studyType));
}

/**
 * Skills, from the skills SECTION when there is one and from detected tokens when
 * there is not. A section is preferred because the person chose those words; the
 * token fallback exists so a résumé with no skills heading still lists something.
 */
function toSkills(parsed: ParsedResume): CanvasResumeSkill[] {
  const declared = sectionLines(parsed, 'skills')
    .flatMap((line) => stripBullet(line).split(/[,;|•·]/))
    .map((skill) => skill.trim())
    // Drop "Skills:" style label prefixes and anything long enough to be a sentence.
    .map((skill) => skill.replace(/^[A-Za-z /&]{2,24}:\s*/, '').trim())
    .filter((skill) => skill.length > 1 && skill.length <= 48);
  const names = declared.length > 0 ? declared : parsed.skillTokens;
  const seen = new Set<string>();
  return names
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 60)
    .map((name, index) => ({ id: `skill-${index + 1}`, name } satisfies CanvasResumeSkill));
}

/**
 * The person's name — the first substantial line that is not a contact detail.
 *
 * Résumés lead with the name in almost every layout, but the first line is sometimes
 * an email or a phone number, so those are skipped rather than accepted as a name.
 */
function inferName(parsed: ParsedResume): string {
  const candidate = parsed.text
    .split('\n')
    .map((line) => line.trim())
    .find((line) =>
      line.length > 1
      && line.length <= 80
      && !PAGE_FURNITURE.test(line)
      && !/[@]/.test(line)
      && !/https?:\/\//i.test(line)
      && !/\d{3}/.test(line)
      && !/^(curriculum vitae|resume|résumé|cv)$/i.test(line));
  // Strip a trailing tagline: "Dana Okafor — Staff Engineer".
  return (candidate ?? '').split(INLINE_SEPARATOR)[0]!.trim().slice(0, 80);
}

function inferSummary(parsed: ParsedResume): string {
  const lines = sectionLines(parsed, 'summary').map(stripBullet);
  return lines.join(' ').trim().slice(0, 1200);
}

/**
 * The headline: an explicit label line under the name, else the most recent role.
 * A résumé rarely states one, and a profile that shows a blank headline reads as
 * broken — so it is derived rather than left empty.
 */
function inferHeadline(name: string, work: CanvasResumeWork[]): string {
  const current = work.find((entry) => entry.position);
  if (!current?.position) return '';
  return current.name ? `${current.position} at ${current.name}` : String(current.position);
}

/** Build the structured document. Never throws — an unreadable résumé yields an empty
 *  document with whatever contact details were found, not an error. */
export function resumeDocumentFromText(text: string): CanvasResumeDocument {
  const parsed = parseResume(text);
  const work = toWork(groupDatedEntries(sectionLines(parsed, 'experience')));
  const education = toEducation(groupDatedEntries(sectionLines(parsed, 'education')));
  const skills = toSkills(parsed);
  const name = inferName(parsed);
  const summary = inferSummary(parsed);
  const linkedIn = parsed.contact.links.find((link) => /linkedin\.com\//i.test(link));

  return {
    basics: {
      name,
      label: inferHeadline(name, work),
      ...(parsed.contact.email ? { email: parsed.contact.email } : {}),
      ...(parsed.contact.phone ? { phone: parsed.contact.phone } : {}),
      ...(linkedIn ?? parsed.contact.links[0] ? { url: linkedIn ?? parsed.contact.links[0] } : {}),
      ...(summary ? { summary } : {}),
      location: null,
    },
    ...(work.length ? { work } : {}),
    ...(education.length ? { education } : {}),
    ...(skills.length ? { skills } : {}),
  };
}

/**
 * True when a deterministic parse produced too little to be worth keeping — the signal
 * the caller uses to escalate to the multimodal path instead of storing a shell.
 */
export function resumeDocumentIsThin(document: CanvasResumeDocument): boolean {
  const basics = document.basics ?? {};
  const hasIdentity = Boolean(basics.name || basics.email);
  const hasSubstance = (document.work?.length ?? 0) > 0 || (document.education?.length ?? 0) > 0;
  return !hasIdentity || !hasSubstance;
}
