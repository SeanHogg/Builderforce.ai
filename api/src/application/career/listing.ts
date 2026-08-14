/**
 * The "list my services / hire me" listing, expanded to cover CAREERS.
 *
 * ── THE DECISION THIS MODULE ENCODES ─────────────────────────────────────────────
 * This platform already has a complete for-hire spine: a person opts in with
 * `users.available_for_hire`, publishes a listing in `freelancer_profiles` (headline,
 * discipline, skills, rate, availability, résumé, public slug), and the demand side posts
 * `job_postings` that they bid on with `job_proposals` — which already carries the
 * pipeline `submitted → shortlisted → accepted → declined → withdrawn`.
 *
 * The obvious way to add job-seeking would have been a second silo: a candidate profile,
 * a job application table, an application pipeline. That would have been WRONG, and
 * expensively so — two profiles for one person, two inboxes, two reputations, and the
 * same résumé maintained twice. It also would have violated the platform's own rule that
 * a new kind is a column value, not a new table.
 *
 * The insight is that the spine already models employment and nobody wired it up:
 * `job_postings.postingType` accepts `'fte'` and `engagementType` accepts `'fte'`. A
 * full-time job IS a posting. An application IS a proposal. What was missing was never
 * the pipeline — it was the SUPPLY side saying which of the two things it wants.
 *
 * So this module adds exactly one concept to the existing listing: {@link SeekingMode} —
 * what this person is open to — plus the career fields that only make sense for
 * employment (target roles, seniority, desired salary, work mode, notice period). One
 * listing, one résumé, one reputation, two kinds of demand.
 *
 * ── WHY IT IS PURE ───────────────────────────────────────────────────────────────
 * Nothing here reads the database. It takes the listing row's shape and returns
 * readings, so the identical logic serves the tenant tools, the public talent directory,
 * and an anonymous visitor drafting a listing they have not saved yet.
 */

import { displaySkill, isSkillToken, tokenSet } from './lexicon';
import { parseResume } from './resumeModel';

/**
 * What a person is open to.
 *
 * `both` is the common case and the reason this is one listing rather than two: someone
 * out of work takes contract work while interviewing, and the platform that forces them
 * to choose loses whichever half they did not pick.
 */
export const SEEKING_MODES = ['services', 'employment', 'both', 'not_looking'] as const;
export type SeekingMode = typeof SEEKING_MODES[number];

export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkMode = typeof WORK_MODES[number];

/** The listing as this domain sees it — the storable fields, nothing else. */
export interface CareerListing {
  headline: string | null;
  bio: string | null;
  discipline: string | null;
  skills: string[];
  hourlyRateCents: number | null;
  currency: string;
  availability: string;
  location: string | null;
  timezone: string | null;
  published: boolean;
  slug: string | null;
  avatarKey: string | null;
  resumeFilename: string | null;
  // ── The career half ──────────────────────────────────────────────────────────
  seeking: SeekingMode;
  targetRoles: string[];
  seniority: string | null;
  desiredSalaryMinCents: number | null;
  desiredSalaryMaxCents: number | null;
  workMode: WorkMode | null;
  noticePeriodDays: number | null;
  openToRelocation: boolean;
}

/** Coerce an unknown seeking value to a declared mode. */
export function normalizeSeeking(value: unknown): SeekingMode {
  const raw = String(value ?? '').trim().toLowerCase();
  return (SEEKING_MODES as readonly string[]).includes(raw) ? (raw as SeekingMode) : 'services';
}

/** Coerce an unknown work-mode value, or null when unstated. */
export function normalizeWorkMode(value: unknown): WorkMode | null {
  const raw = String(value ?? '').trim().toLowerCase();
  return (WORK_MODES as readonly string[]).includes(raw) ? (raw as WorkMode) : null;
}

/** True when this listing wants to be found for full-time employment. */
export function seeksEmployment(seeking: SeekingMode): boolean {
  return seeking === 'employment' || seeking === 'both';
}

/** True when this listing wants to be found for project / contract work. */
export function seeksServices(seeking: SeekingMode): boolean {
  return seeking === 'services' || seeking === 'both';
}

/**
 * The posting types a listing should be shown, derived from its seeking mode.
 *
 * This is the single mapping between the supply side's intent and the demand side's
 * `job_postings.postingType` vocabulary, so the job feed, the tool that searches it and
 * any future match digest cannot disagree about who sees what.
 */
export function postingTypesFor(seeking: SeekingMode): string[] {
  const types: string[] = [];
  if (seeksServices(seeking)) types.push('project_bid', 'design');
  if (seeksEmployment(seeking)) types.push('fte');
  return types;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export interface ListingReadiness {
  seeking: SeekingMode;
  /** 0..100 per demand channel this listing has opted into. */
  channels: Array<{
    channel: 'services' | 'employment';
    score: number;
    blocking: string[];
    improving: string[];
  }>;
  /** Whether the listing is discoverable AT ALL right now. */
  discoverable: boolean;
  instruction: string;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Grade a listing SEPARATELY per channel, because the two demand sides read different
 * fields and a listing can be excellent for one and invisible to the other.
 *
 * A client hiring for a project filters on discipline, skills and rate. An employer
 * filling a role filters on target role, seniority and availability to start — and the
 * single most common reason a strong freelancer profile never surfaces in an employment
 * search is that it never said it wanted one.
 */
export function listingReadiness(listing: CareerListing): ListingReadiness {
  const text = (v: unknown): string => String(v ?? '').trim();
  const channels: ListingReadiness['channels'] = [];

  if (seeksServices(listing.seeking)) {
    const blocking: string[] = [];
    const improving: string[] = [];
    if (!listing.published) blocking.push('The listing is not published, so no client can find it.');
    if (!text(listing.headline)) blocking.push('No headline — the only line shown on a search result.');
    if (!text(listing.discipline)) blocking.push('No discipline, so the listing appears in no category.');
    if (listing.skills.length < 5) blocking.push(`Only ${listing.skills.length} skills — most client searches filter on five or more.`);
    if (!listing.hourlyRateCents) improving.push('No rate published. A rate filters out the wrong enquiries before they cost a conversation.');
    if (!text(listing.avatarKey)) improving.push('No profile picture — skipped in a grid of listings that have one.');
    if (text(listing.bio).length < 120) improving.push('The bio is under 120 characters and reads as unfinished.');
    channels.push({ channel: 'services', score: clamp(100 - blocking.length * 22 - improving.length * 7), blocking, improving });
  }

  if (seeksEmployment(listing.seeking)) {
    const blocking: string[] = [];
    const improving: string[] = [];
    if (!listing.published) blocking.push('The listing is not published, so no employer can find it.');
    if (!listing.targetRoles.length) blocking.push('No target roles named. An employment search matches a role title, and this listing states none.');
    if (!text(listing.resumeFilename)) blocking.push('No résumé attached — an employer who likes the profile has nothing to forward internally.');
    if (!text(listing.seniority)) blocking.push('No seniority stated, so the listing matches every level and ranks for none.');
    if (listing.skills.length < 5) blocking.push(`Only ${listing.skills.length} skills — below what a role filter needs.`);
    if (!listing.desiredSalaryMinCents) improving.push('No salary expectation. Stating one saves a round of screening on both sides.');
    if (!listing.workMode) improving.push('No work mode (remote / hybrid / onsite) — the first filter most employers apply.');
    if (listing.noticePeriodDays == null) improving.push('No notice period, so "when could you start?" is still a question rather than an answer.');
    if (!text(listing.location) && !text(listing.timezone)) improving.push('Neither location nor timezone — an employer cannot judge overlap or right-to-work.');
    channels.push({ channel: 'employment', score: clamp(100 - blocking.length * 20 - improving.length * 6), blocking, improving });
  }

  if (!channels.length) {
    return {
      seeking: listing.seeking,
      channels: [],
      discoverable: false,
      instruction: `This listing is set to "${listing.seeking}", so it is not offered to either demand channel. If the person is looking for work, set seeking to "services", "employment" or "both" first — nothing else on the listing matters until then.`,
    };
  }

  return {
    seeking: listing.seeking,
    channels,
    discoverable: listing.published && channels.some((c) => c.blocking.length === 0),
    instruction: 'Report each channel separately — a listing can be strong for contract work and invisible for employment, and the person cannot tell from looking at it. Fix everything in `blocking` before anything in `improving`: a blocking item means nobody sees the listing at all, so polishing the bio underneath one is wasted work.',
  };
}

// ---------------------------------------------------------------------------
// Drafting a listing from the résumé that already exists
// ---------------------------------------------------------------------------

export interface ListingDraft {
  /** Fields derived from the résumé, each with the evidence behind it. */
  proposed: {
    discipline: string | null;
    skills: string[];
    seniority: string | null;
    targetRoles: string[];
  };
  evidence: {
    skillsFound: number;
    strongestBullets: string[];
    yearsSpanned: number | null;
  };
  headlineBrief: string;
  bioBrief: string;
  instruction: string;
}

/**
 * Draft the listing from the résumé the person already uploaded.
 *
 * The reason this exists: the listing and the résumé contain the same facts, and asking
 * a person out of work to retype them is exactly the friction that leaves half the
 * listings on any marketplace at 30% complete. Structured fields are derived; the two
 * prose fields are returned as BRIEFS for the caller to write and the person to approve,
 * because a headline written about someone without their sign-off is a stranger's
 * description of them on a public page.
 */
export function draftListingFromResume(resumeText: string, seeking: SeekingMode = 'both'): ListingDraft {
  const resume = parseResume(resumeText);
  const skills = resume.skillTokens.map(displaySkill);

  const years = resume.dates
    .flatMap((d) => [d.start, d.end === 'Present' ? null : d.end])
    .filter((v): v is string => !!v)
    .map((v) => Number(v.slice(0, 4)))
    .filter((n) => Number.isFinite(n) && n > 1950);
  const yearsSpanned = years.length >= 2 ? Math.max(...years) - Math.min(...years) : null;

  const seniority = yearsSpanned == null ? null
    : yearsSpanned >= 12 ? 'principal'
      : yearsSpanned >= 8 ? 'senior'
        : yearsSpanned >= 4 ? 'mid'
          : yearsSpanned >= 1 ? 'junior' : null;

  // Discipline is inferred from the densest skill area, not from a job title: titles are
  // company-specific and a title-derived discipline mis-files half of everyone.
  const areaCounts = new Map<string, number>();
  for (const token of resume.skillTokens) {
    const area = tokenSet(displaySkill(token)).filter(isSkillToken).length ? token : token;
    areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
  }
  const discipline = skills.length ? inferDiscipline(resume.skillTokens) : null;

  const strongestBullets = [...resume.bullets]
    .filter((b) => b.quantified || b.strongOpener)
    .sort((a, b) => Number(b.quantified) - Number(a.quantified) || b.length - a.length)
    .slice(0, 4)
    .map((b) => b.text);

  return {
    proposed: {
      discipline,
      skills: skills.slice(0, 24),
      seniority,
      targetRoles: discipline ? [discipline] : [],
    },
    evidence: {
      skillsFound: skills.length,
      strongestBullets,
      yearsSpanned,
    },
    headlineBrief: `One line, under about 90 characters. Name what they do and the outcome they produce — not a job title alone. Draw only on the skills and bullets above.${seeksEmployment(seeking) ? ' It must read correctly to an employer as well as a client, because this listing is offered to both.' : ''}`,
    bioBrief: 'Two short paragraphs: what they do and for whom, then the proof — quote a number from `strongestBullets`. No adjectives that the evidence does not support.',
    instruction: 'Propose the derived fields and the two drafted prose fields TOGETHER, in one message, and ask for approval before saving. Never publish a listing on someone\'s behalf without showing them the exact words that will appear under their name.',
  };
}

/** Infer a discipline label from the skill mix. Declared as data, ordered most specific first. */
function inferDiscipline(tokens: readonly string[]): string | null {
  const has = (t: string): boolean => tokens.includes(t);
  const rules: ReadonlyArray<readonly [string, () => boolean]> = [
    ['data-scientist', () => has('machinelearning') && (has('python') || has('pytorch'))],
    ['data-engineer', () => has('etl') || has('airflow') || has('dbt') || has('spark')],
    ['devops', () => has('kubernetes') || has('terraform') || (has('docker') && has('cicd'))],
    ['security', () => has('compliance') && has('linux')],
    ['frontend', () => (has('react') || has('vue') || has('angular')) && !has('postgresql')],
    ['backend', () => (has('nodejs') || has('python') || has('java') || has('go')) && (has('sql') || has('postgresql'))],
    ['fullstack', () => (has('react') || has('vue')) && (has('nodejs') || has('python'))],
    ['designer', () => has('figma') || has('userexperience') || has('prototyping')],
    ['product', () => has('productmanagement') || has('roadmapping')],
    ['qa', () => has('qualityassurance') || has('tdd')],
    ['analyst', () => has('analytics') && has('sql')],
    ['marketing', () => has('seo') || has('contentmarketing')],
    ['sales', () => has('crm') && has('b2b')],
    ['developer', () => has('javascript') || has('typescript') || has('python') || has('java')],
  ];
  for (const [label, matches] of rules) if (matches()) return label;
  return null;
}

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

export interface ValueProposition {
  company: string;
  role: string;
  /** What the person brings that the target's stated need actually asks for. */
  aligned: string[];
  /** Strengths the target did not ask for — the differentiator, used sparingly. */
  differentiators: string[];
  /** Gaps to address head-on rather than hope go unnoticed. */
  toAddress: string[];
  structure: Array<{ part: string; guidance: string }>;
  instruction: string;
}

/**
 * Position one person against one named opportunity.
 *
 * Structured rather than generated: the tool supplies the alignment, the differentiators
 * and the gaps as evidence, and the caller writes the sentences. A value proposition
 * written entirely by a machine reads like one, and the person has to say it out loud.
 */
export function valueProposition(input: {
  resumeText: string;
  company: string;
  role: string;
  jobDescription?: string;
}): ValueProposition {
  const resume = parseResume(input.resumeText);
  const have = new Set(resume.skillTokens);
  const wanted = input.jobDescription ? tokenSet(input.jobDescription).filter(isSkillToken) : [];
  const aligned = wanted.filter((token) => have.has(token)).map(displaySkill);
  const toAddress = wanted.filter((token) => !have.has(token)).slice(0, 5).map(displaySkill);
  const differentiators = resume.skillTokens
    .filter((token) => !wanted.includes(token))
    .slice(0, 6)
    .map(displaySkill);

  return {
    company: input.company,
    role: input.role,
    aligned,
    differentiators,
    toAddress,
    structure: [
      { part: 'The opening claim', guidance: `One sentence naming what ${input.company} is trying to do in this ${input.role} and what the person does about it. If the job description was supplied, quote its language back.` },
      { part: 'The proof', guidance: 'One quantified result from their own bullets that maps onto the aligned skills. One only — a list of three reads as a résumé, not a proposition.' },
      { part: 'The differentiator', guidance: differentiators.length ? `Pick ONE of: ${differentiators.join(', ')}. The point is what they bring that the posting did not think to ask for.` : 'No surplus skills were found beyond what the posting asks for; use the depth of one aligned skill instead.' },
      { part: 'The honest edge', guidance: toAddress.length ? `Name ${toAddress[0]} before they do, with what they would do about it. A gap raised by the candidate is a strength; the same gap found by the interviewer is a doubt.` : 'No material gap was detected against the stated requirements — do not manufacture one.' },
    ],
    instruction: 'Write it in the person\'s voice, under 120 words, using only the evidence above. Then ask them which sentence is not true — that question catches every fabrication the evidence let through.',
  };
}

// ---------------------------------------------------------------------------
// Publishing the same listing elsewhere
// ---------------------------------------------------------------------------

/** The external profiles people maintain alongside this one. */
export const PROFILE_VENDORS = [
  'linkedin', 'indeed', 'glassdoor', 'ziprecruiter', 'wellfound', 'dice', 'monster',
] as const;
export type ProfileVendor = typeof PROFILE_VENDORS[number];

export interface ProfileBlocks {
  vendor: ProfileVendor;
  /** Vendor-specific limits, so a block is never rejected on paste. */
  limits: { headline: number; summary: number };
  blocks: Array<{ field: string; content: string; truncated: boolean }>;
  instruction: string;
}

const VENDOR_LIMITS: Readonly<Record<ProfileVendor, { headline: number; summary: number }>> = {
  linkedin: { headline: 220, summary: 2600 },
  indeed: { headline: 150, summary: 2000 },
  glassdoor: { headline: 150, summary: 2000 },
  ziprecruiter: { headline: 150, summary: 2000 },
  wellfound: { headline: 120, summary: 1500 },
  dice: { headline: 150, summary: 2000 },
  monster: { headline: 180, summary: 2000 },
};

/**
 * Render the listing as paste-ready blocks for one external profile.
 *
 * One master listing, seven destinations. The value is not the copying — it is that the
 * seven stay CONSISTENT, because a person who edits their LinkedIn headline and forgets
 * the other six ends up with a different story on every page a recruiter opens.
 */
export function profileBlocks(listing: CareerListing, vendor: ProfileVendor): ProfileBlocks {
  const limits = VENDOR_LIMITS[vendor];
  const cut = (value: string, max: number): { content: string; truncated: boolean } =>
    value.length <= max ? { content: value, truncated: false } : { content: `${value.slice(0, max - 1).trimEnd()}…`, truncated: true };

  const headline = cut(String(listing.headline ?? '').trim(), limits.headline);
  const summary = cut(String(listing.bio ?? '').trim(), limits.summary);
  const skills = listing.skills.slice(0, vendor === 'linkedin' ? 50 : 20).join(', ');
  const openTo = [
    seeksEmployment(listing.seeking) ? `${listing.workMode ?? 'any work mode'} employment${listing.targetRoles.length ? ` as ${listing.targetRoles.join(' / ')}` : ''}` : null,
    seeksServices(listing.seeking) ? 'contract and project work' : null,
  ].filter(Boolean).join(' · ');

  return {
    vendor,
    limits,
    blocks: [
      { field: 'headline', content: headline.content, truncated: headline.truncated },
      { field: 'summary', content: summary.content, truncated: summary.truncated },
      { field: 'skills', content: skills, truncated: false },
      { field: 'openTo', content: openTo, truncated: false },
    ],
    instruction: `Give the person each block to paste into ${vendor}. Where \`truncated\` is true, say which block was cut and offer a shortened rewrite rather than letting the vendor cut it mid-sentence. Do not change the wording between vendors — the point of this is that all of them say the same thing.`,
  };
}

// ---------------------------------------------------------------------------
// Employer research
// ---------------------------------------------------------------------------

export interface EmployerResearchBrief {
  company: string;
  /** What to find out, and why each one changes a decision. */
  questions: Array<{ question: string; whyItMatters: string; whereToLook: string }>;
  instruction: string;
}

/**
 * The brief for researching an employer.
 *
 * This tool deliberately returns QUESTIONS rather than answers: it has no data source,
 * and a confident paragraph about a company assembled from a language model's weights is
 * the single most dangerous output in this domain — the person repeats it in an
 * interview to someone who works there.
 */
export function employerResearchBrief(company: string, role?: string): EmployerResearchBrief {
  const target = company.trim() || 'the company';
  return {
    company: target,
    questions: [
      { question: `What does ${target} actually sell, and to whom?`, whyItMatters: 'Every other answer depends on this, and candidates routinely get it one level too abstract to be useful in a room.', whereToLook: 'The pricing page and the customer logos — not the About page.' },
      { question: 'How is it funded, and how long has it been since the last raise or a profitable year?', whyItMatters: 'This is the difference between a role that exists in eighteen months and one that does not.', whereToLook: 'Funding announcements, filings, and any published headcount trend.' },
      { question: `Who would this ${role?.trim() || 'role'} report to, and how long have they been there?`, whyItMatters: 'The manager decides the job far more than the job description does.', whereToLook: 'The public profile of the person, and the tenure of their reports.' },
      { question: 'What has changed there in the last six months?', whyItMatters: 'A specific, recent observation is the one thing in an interview that cannot be prepared generically — it proves the interest is real.', whereToLook: 'Their newsroom, changelog, engineering blog and recent posts.' },
      { question: 'What do current and former employees say, and what is the pattern rather than the outlier?', whyItMatters: 'One angry review is noise; the same complaint five times is the job.', whereToLook: 'Review sites, read for repetition rather than sentiment.' },
      { question: 'What is the honest case AGAINST joining?', whyItMatters: 'Not asking it is how people end up back on the market in eight months.', whereToLook: 'The gap between what the posting promises and what the funding and reviews imply.' },
    ],
    instruction: `Answer these by RESEARCHING — call the web search and page-read tools and cite what you actually read. Do not answer any of them from memory: a confident, wrong claim about ${target} is one the person will repeat to someone who works there. Where you cannot find something, say it was not found.`,
  };
}
