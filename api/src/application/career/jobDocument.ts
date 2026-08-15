/**
 * A job description, read out of whatever the person pasted or uploaded.
 *
 * ── WHY THIS IS IN `career/` AND NOT `hiring/` ───────────────────────────────────
 * This reads a posting from the OUTSIDE — a PDF a recruiter emailed, a page copied out
 * of a job board, a description pasted into a box. That is a job SEEKER's act, and the
 * output feeds the seeker's own tools: match my résumé against this, tailor a variant
 * for it, tell me what I am missing. The hiring domain's job posting is the other thing
 * entirely — a record this platform's employer authored and owns.
 *
 * Deliberately model-free, like the rest of `career/`. A JD is highly structured prose
 * with conventional headings, and the fields that matter downstream (title, employer,
 * requirements, skills) are exactly the ones those headings name. `extractSkills` then
 * does the vocabulary work, so the matcher and this reader cannot disagree about what
 * counts as a skill.
 */
import { extractSkills, type ExtractedSkills } from './jobMatch';

export interface JobDescriptionDocument {
  title: string | null;
  company: string | null;
  location: string | null;
  /** 'remote' | 'hybrid' | 'onsite', when the posting says. */
  workMode: 'remote' | 'hybrid' | 'onsite' | null;
  employmentType: string | null;
  salaryText: string | null;
  requirements: string[];
  responsibilities: string[];
  benefits: string[];
  skills: string[];
  /** The full text, kept because every matcher scores against prose, not fields. */
  text: string;
}

const BULLET = /^\s*[-–—•·▪◦*‣⁃]\s+/;
const stripBullet = (line: string): string => line.replace(BULLET, '').trim();

/** Section headings a posting uses, mapped to the list they open. */
const SECTIONS: ReadonlyArray<readonly ['requirements' | 'responsibilities' | 'benefits', RegExp]> = [
  ['requirements', /^(requirements?|qualifications?|what (you'?ll )?(need|bring)|who you are|about you|skills? (and|&) experience|must[- ]haves?)\b/i],
  ['responsibilities', /^(responsibilit|what you'?ll do|the role|duties|day[- ]to[- ]day|about the (role|job)|your impact)\b/i],
  ['benefits', /^(benefits?|what we offer|perks|compensation (and|&) benefits|why join)\b/i],
];

/** A heading is short and either title-cased or colon-terminated. */
function sectionFor(line: string): 'requirements' | 'responsibilities' | 'benefits' | null {
  const trimmed = line.replace(/[#*_:]/g, '').trim();
  if (!trimmed || trimmed.length > 70) return null;
  for (const [key, pattern] of SECTIONS) if (pattern.test(trimmed)) return key;
  return null;
}

/**
 * The value of a `Label: value` line.
 *
 * The alternation is wrapped in a non-capturing group on purpose: without it,
 * `^\s*company|employer\s*[:-]\s*(.+)$` parses as "line starts with company" OR
 * "employer followed by a colon", so only the LAST alternative ever carried the
 * anchors — and the first label silently never matched.
 */
const LABELLED = (label: RegExp, text: string): string | null => {
  const match = text.match(new RegExp(`^\\s*(?:${label.source})\\s*[:\\-]\\s*(.+)$`, 'im'));
  return match?.[1]?.trim().slice(0, 200) ?? null;
};

function inferWorkMode(text: string): JobDescriptionDocument['workMode'] {
  // Ordered: a posting saying "hybrid (2 days remote)" is hybrid, not remote.
  if (/\bhybrid\b/i.test(text)) return 'hybrid';
  if (/\b(fully[- ])?remote\b|\bwork from home\b|\bwfh\b/i.test(text)) return 'remote';
  if (/\bon[- ]?site\b|\bin[- ]office\b/i.test(text)) return 'onsite';
  return null;
}

function inferEmploymentType(text: string): string | null {
  const patterns: ReadonlyArray<readonly [string, RegExp]> = [
    ['full-time', /\bfull[- ]time\b/i], ['part-time', /\bpart[- ]time\b/i],
    ['contract', /\bcontract(or)?\b|\bfixed[- ]term\b/i], ['internship', /\bintern(ship)?\b/i],
    ['temporary', /\btemporary\b|\btemp\b/i],
  ];
  for (const [value, pattern] of patterns) if (pattern.test(text)) return value;
  return null;
}

/**
 * Parse a job description. Never throws and never returns null — an unreadable posting
 * still yields its text, which is all the matcher strictly needs.
 */
export function jobDocumentFromText(input: string): JobDescriptionDocument {
  const text = String(input ?? '').replace(/\r\n?/g, '\n').trim();
  const lines = text.split('\n').map((line) => line.trim());
  const nonEmpty = lines.filter(Boolean);

  const buckets: Record<'requirements' | 'responsibilities' | 'benefits', string[]> = {
    requirements: [], responsibilities: [], benefits: [],
  };
  let current: keyof typeof buckets | null = null;
  for (const line of lines) {
    const heading = sectionFor(line);
    if (heading) { current = heading; continue; }
    if (!line) continue;
    // A new non-bullet heading-shaped line ends the current list.
    if (current && !BULLET.test(line) && line.length < 70 && /:$/.test(line)) { current = null; continue; }
    if (current && BULLET.test(line)) buckets[current].push(stripBullet(line).slice(0, 400));
  }

  const explicitTitle = LABELLED(/(job )?title|position|role/, text);
  // Otherwise the first substantial line — postings lead with the title almost always.
  const title = explicitTitle ?? nonEmpty.find((line) => line.length > 2 && line.length <= 120 && !/[@]/.test(line)) ?? null;

  const skills: ExtractedSkills = extractSkills(text, 'job');


  return {
    title: title ? title.slice(0, 200) : null,
    company: LABELLED(/company|employer|organi[sz]ation/, text),
    location: LABELLED(/location|based in|office/, text),
    workMode: inferWorkMode(text),
    employmentType: inferEmploymentType(text),
    salaryText: LABELLED(/salary|compensation|pay|rate/, text),
    requirements: buckets.requirements.slice(0, 40),
    responsibilities: buckets.responsibilities.slice(0, 40),
    benefits: buckets.benefits.slice(0, 30),
    skills: skills.flat.slice(0, 60),
    text,
  };
}
