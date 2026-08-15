/**
 * Résumé analysis — the scoring, tone, summary, critique and merge readings.
 *
 * ── EVERY NUMBER HERE IS EARNED ──────────────────────────────────────────────────
 * A résumé score that comes out of a language model is a number the model made up; ask
 * twice and it moves. That is not a defect anyone notices until a person rewrites their
 * document to chase a score that was never measuring anything.
 *
 * So every category below is a COUNT over the parsed document, with the count reported
 * alongside the score. "Impact 48/100 — 4 of 17 bullets carry a number" is a statement a
 * person can act on and argue with. It also means the caller (which, on this platform,
 * is itself a language model) gets evidence to write prose FROM, rather than a verdict
 * to paraphrase. Tools measure; the model writes.
 *
 * The one thing these functions never do is invent content. `optimizeResume` returns the
 * edits it can prove are needed and the exact text they apply to; the wording of a
 * replacement bullet is the calling model's job, because only it knows what the person
 * actually did.
 */

import {
  STRONG_VERBS, displaySkill, isSkillToken, skillGroupOf, toneCounts, tokenCounts,
} from './lexicon';
import { isTooShortToScore, parseResume, type ParsedResume, type ResumeBullet } from './resumeModel';

export interface ScoreCategory {
  key: 'ats' | 'content' | 'keywords' | 'format' | 'impact';
  label: string;
  score: number;
  /** The measurement the score came from, in words a person can check. */
  evidence: string;
}

export interface ResumeScore {
  overall: number;
  categories: ScoreCategory[];
  strengths: string[];
  weaknesses: string[];
  recommendations: Array<{ title: string; detail: string; priority: 'high' | 'medium' | 'low' }>;
  measured: {
    words: number;
    bullets: number;
    quantifiedBullets: number;
    strongOpeners: number;
    weakOpeners: number;
    skills: number;
    sections: string[];
    dateStyles: string[];
  };
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Score a résumé across the five categories a screener actually filters on. */
export function scoreResume(input: string): ResumeScore {
  const parsed = parseResume(input);
  const bullets = parsed.bullets;
  const quantified = bullets.filter((b) => b.quantified).length;
  const strong = bullets.filter((b) => b.strongOpener).length;
  const weak = bullets.filter((b) => b.weakOpener).length;
  const kinds = [...new Set(parsed.sections.map((s) => s.kind))].filter((k) => k !== 'other');
  const dateStyles = [...new Set(parsed.dates.map((d) => d.style))];

  // ── ATS: can a parser find the structure and reach the person? ────────────────
  const hasSummary = kinds.includes('summary');
  const hasExperience = kinds.includes('experience');
  const hasSkills = kinds.includes('skills');
  const hasEducation = kinds.includes('education');
  const atsPoints =
    (parsed.contact.email ? 22 : 0) +
    (parsed.contact.phone ? 12 : 0) +
    (hasExperience ? 24 : 0) +
    (hasSkills ? 16 : 0) +
    (hasEducation ? 10 : 0) +
    (hasSummary ? 8 : 0) +
    (bullets.length >= 5 ? 8 : bullets.length * 1.5);
  const ats = clamp(atsPoints);

  // ── Content: is there enough of it, and is it in bullets? ────────────────────
  const lengthScore = parsed.wordCount < 200 ? (parsed.wordCount / 200) * 70
    : parsed.wordCount > 1200 ? Math.max(45, 100 - (parsed.wordCount - 1200) / 25)
      : 70 + Math.min(30, (parsed.wordCount - 200) / 20);
  const bulletShare = bullets.length === 0 ? 0 : Math.min(1, bullets.length / 12);
  const content = clamp(lengthScore * 0.65 + bulletShare * 100 * 0.35);

  // ── Keywords: how much of the document is recognisable skill vocabulary? ─────
  const distinctSkills = parsed.skillTokens.length;
  const groups = new Set(parsed.skillTokens.map(skillGroupOf).filter(Boolean));
  const keywords = clamp(Math.min(100, distinctSkills * 6) * 0.7 + Math.min(100, groups.size * 22) * 0.3);

  // ── Format: consistent dates, scannable bullets, no walls of text ────────────
  const overlong = bullets.filter((b) => b.length > 220).length;
  const dateConsistency = dateStyles.length <= 1 ? 100 : dateStyles.length === 2 ? 65 : 35;
  const bulletLengthScore = bullets.length === 0 ? 50 : clamp(100 - (overlong / bullets.length) * 90);
  const format = clamp(dateConsistency * 0.45 + bulletLengthScore * 0.35 + (parsed.dates.length ? 100 : 40) * 0.2);

  // ── Impact: do the bullets claim a result, or a presence? ────────────────────
  const quantShare = bullets.length ? quantified / bullets.length : 0;
  const strongShare = bullets.length ? strong / bullets.length : 0;
  const weakPenalty = bullets.length ? (weak / bullets.length) * 45 : 0;
  const impact = clamp(quantShare * 55 + strongShare * 45 + 12 - weakPenalty);

  const categories: ScoreCategory[] = [
    { key: 'ats', label: 'ATS readability', score: ats, evidence: `${parsed.contact.email ? 'email present' : 'NO email'}, ${parsed.contact.phone ? 'phone present' : 'no phone'}, sections found: ${kinds.length ? kinds.join(', ') : 'none recognised'}` },
    { key: 'content', label: 'Content depth', score: content, evidence: `${parsed.wordCount} words across ${bullets.length} bullet${bullets.length === 1 ? '' : 's'}` },
    { key: 'keywords', label: 'Keyword coverage', score: keywords, evidence: `${distinctSkills} distinct recognised skill${distinctSkills === 1 ? '' : 's'} across ${groups.size} area${groups.size === 1 ? '' : 's'}` },
    { key: 'format', label: 'Formatting', score: format, evidence: `${parsed.dates.length} date range${parsed.dates.length === 1 ? '' : 's'} in ${dateStyles.length || 0} format${dateStyles.length === 1 ? '' : 's'}; ${overlong} bullet${overlong === 1 ? '' : 's'} over 220 characters` },
    { key: 'impact', label: 'Impact language', score: impact, evidence: `${quantified} of ${bullets.length} bullets carry a number; ${strong} open with an ownership verb; ${weak} open with a passive phrase` },
  ];

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (parsed.contact.email && parsed.contact.phone) strengths.push('Both an email and a phone number are present, so a recruiter can reach you without hunting.');
  if (quantShare >= 0.4) strengths.push(`${quantified} of ${bullets.length} bullets are quantified — above the point where a screener starts believing the claims.`);
  if (strongShare >= 0.5) strengths.push('Most bullets open with an ownership verb rather than a description of the role.');
  if (groups.size >= 4) strengths.push(`Skills span ${groups.size} distinct areas, which reads as range rather than a single tool.`);
  if (dateStyles.length === 1 && parsed.dates.length >= 2) strengths.push('Every date range is written the same way — an ATS will parse your tenure correctly.');

  if (!parsed.contact.email) weaknesses.push('No email address was found. This is the single most common reason a parsed résumé is discarded.');
  if (!hasSkills) weaknesses.push('No skills section was found, so keyword filters have nothing structured to match against.');
  if (!hasSummary) weaknesses.push('No summary or profile section — the top of the page is the only part most screeners read in full.');
  if (quantShare < 0.25 && bullets.length >= 4) weaknesses.push(`Only ${quantified} of ${bullets.length} bullets carry a number. Unquantified work reads as an activity list.`);
  if (weak > 0) weaknesses.push(`${weak} bullet${weak === 1 ? '' : 's'} open with a passive phrase such as "${bullets.find((b) => b.weakOpener)?.weakOpener}" — these describe presence, not contribution.`);
  if (dateStyles.length > 1) weaknesses.push(`Dates are written in ${dateStyles.length} different formats (${dateStyles.join(', ')}), which mis-parses tenure in most applicant tracking systems.`);
  if (overlong > 0) weaknesses.push(`${overlong} bullet${overlong === 1 ? ' runs' : 's run'} past 220 characters — past three lines, a bullet stops being scanned.`);
  if (distinctSkills < 6) weaknesses.push(`Only ${distinctSkills} recognised skill${distinctSkills === 1 ? '' : 's'} appear anywhere in the document.`);

  const recommendations = buildRecommendations(parsed, { quantified, weak, overlong, dateStyles, hasSummary, hasSkills, distinctSkills });
  const overall = clamp(ats * 0.24 + content * 0.16 + keywords * 0.2 + format * 0.16 + impact * 0.24);

  return {
    overall: isTooShortToScore(parsed) ? Math.min(overall, 35) : overall,
    categories,
    strengths,
    weaknesses,
    recommendations,
    measured: {
      words: parsed.wordCount,
      bullets: bullets.length,
      quantifiedBullets: quantified,
      strongOpeners: strong,
      weakOpeners: weak,
      skills: distinctSkills,
      sections: kinds,
      dateStyles,
    },
  };
}

function buildRecommendations(
  parsed: ParsedResume,
  m: { quantified: number; weak: number; overlong: number; dateStyles: string[]; hasSummary: boolean; hasSkills: boolean; distinctSkills: number },
): ResumeScore['recommendations'] {
  const out: ResumeScore['recommendations'] = [];
  if (!parsed.contact.email) out.push({ title: 'Add a contact email', detail: 'No email was found in the document. Put it on the first line, as plain text — an email inside a header image or text box is invisible to a parser.', priority: 'high' });
  if (!m.hasSkills) out.push({ title: 'Add a Skills section', detail: 'Create a "Skills" heading listing the tools and methods you actually use. Keyword filters read this section structurally; skills mentioned only inside prose are frequently missed.', priority: 'high' });
  if (!m.hasSummary) out.push({ title: 'Add a three-line summary', detail: 'Open with what you do, the scale you have done it at, and what you are looking for. This is the only section many screeners read in full.', priority: 'high' });
  if (m.weak > 0) {
    const example = parsed.bullets.find((b) => b.weakOpener);
    out.push({ title: `Rewrite ${m.weak} passive bullet${m.weak === 1 ? '' : 's'}`, detail: `${m.weak} bullet${m.weak === 1 ? '' : 's'} open with a phrase such as "${example?.weakOpener}". Replace the opener with what you did and what changed — for example "${example ? example.text.slice(0, 90) : ''}" becomes a sentence starting with a verb like ${STRONG_VERBS.slice(0, 4).join(', ')}.`, priority: 'high' });
  }
  const unquantified = parsed.bullets.filter((b) => !b.quantified);
  if (unquantified.length >= 3) out.push({ title: `Quantify ${Math.min(5, unquantified.length)} more bullets`, detail: `${unquantified.length} bullets carry no number. Add the size, the delta, or the duration — how many users, what percentage, how much money, how long. Start with: "${unquantified[0]?.text.slice(0, 110) ?? ''}".`, priority: 'high' });
  if (m.dateStyles.length > 1) out.push({ title: 'Use one date format throughout', detail: `Dates appear in ${m.dateStyles.length} formats (${m.dateStyles.join(', ')}). Normalise every range to the same shape — "YYYY-MM" or "Mon YYYY" — and use "Present" for the current role.`, priority: 'medium' });
  if (m.overlong > 0) out.push({ title: `Shorten ${m.overlong} long bullet${m.overlong === 1 ? '' : 's'}`, detail: 'Cut each to under about 180 characters, keeping every metric and proper noun. A bullet that wraps past three lines is skimmed rather than read.', priority: 'medium' });
  if (m.distinctSkills < 8) out.push({ title: 'Name the tools explicitly', detail: `Only ${m.distinctSkills} recognised skills appear. Write the specific technology, framework or method rather than a category — "PostgreSQL" and "Terraform", not "databases" and "infrastructure".`, priority: 'medium' });
  if (parsed.contact.links.length === 0) out.push({ title: 'Add one link that proves the work', detail: 'No portfolio, repository or profile URL was found. One link a reader can open does more than a paragraph of description.', priority: 'low' });
  return out;
}

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

export interface ResumeSentiment {
  score: number;
  label: 'positive' | 'neutral' | 'negative';
  positiveSignals: number;
  negativeSignals: number;
  hedges: number;
  flagged: Array<{ text: string; reason: string }>;
}

/** Read the tone of a résumé — the "does this read as flat or apologetic" question. */
export function resumeSentiment(input: string): ResumeSentiment {
  const parsed = parseResume(input);
  const tone = toneCounts(parsed.text);
  const total = tone.positive + tone.negative + tone.hedges;
  const raw = total === 0 ? 50 : ((tone.positive - tone.negative - tone.hedges * 0.75) / total) * 50 + 50;
  const score = clamp(raw);
  const flagged = parsed.bullets
    .filter((b) => b.weakOpener)
    .slice(0, 8)
    .map((b) => ({ text: b.text, reason: `Opens with "${b.weakOpener}", which describes presence rather than contribution.` }));
  return {
    score,
    label: score >= 62 ? 'positive' : score >= 42 ? 'neutral' : 'negative',
    positiveSignals: tone.positive,
    negativeSignals: tone.negative,
    hedges: tone.hedges,
    flagged,
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface ResumeSummary {
  /** The existing summary section, when the document already has one. */
  existingSummary: string | null;
  topSkills: string[];
  /** Years spanned by the earliest and latest parsed dates, when derivable. */
  yearsSpanned: number | null;
  /** The strongest evidence bullets — quantified and strongly opened, longest first. */
  evidenceBullets: string[];
  /** A structured brief for the caller to write the summary paragraph FROM. */
  brief: {
    whatTheyDo: string;
    scaleEvidence: string[];
    distinctSkills: number;
    instruction: string;
  };
}

/** Assemble the evidence a recruiter-ready summary should be written from. */
export function summarizeResume(input: string): ResumeSummary {
  const parsed = parseResume(input);
  const existing = parsed.sections.find((s) => s.kind === 'summary');
  const counts = tokenCounts(parsed.text);
  const topSkills = [...counts.entries()]
    .filter(([token]) => isSkillToken(token))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([token]) => displaySkill(token));

  const years = parsed.dates
    .flatMap((d) => [d.start, d.end === 'Present' ? null : d.end])
    .filter((v): v is string => !!v)
    .map((v) => Number(v.slice(0, 4)))
    .filter((n) => Number.isFinite(n) && n > 1950);
  const yearsSpanned = years.length >= 2 ? Math.max(...years) - Math.min(...years) : null;

  const evidenceBullets = [...parsed.bullets]
    .filter((b) => b.quantified || b.strongOpener)
    .sort((a, b) => Number(b.quantified) - Number(a.quantified) || b.length - a.length)
    .slice(0, 6)
    .map((b) => b.text);

  return {
    existingSummary: existing?.body.trim() || null,
    topSkills,
    yearsSpanned,
    evidenceBullets,
    brief: {
      whatTheyDo: topSkills.slice(0, 4).join(', ') || 'not derivable from the document',
      scaleEvidence: evidenceBullets.slice(0, 3),
      distinctSkills: parsed.skillTokens.length,
      instruction: 'Write three sentences: what this person does, the largest scale they have demonstrably done it at (quote a number from scaleEvidence), and what they are looking for next. Use ONLY the evidence above — do not introduce an employer, a title, or a metric that does not appear in it.',
    },
  };
}

// ---------------------------------------------------------------------------
// Critique
// ---------------------------------------------------------------------------

export interface ResumeRoast {
  score: number;
  /** The specific, quotable problems — each anchored to real text. */
  hits: Array<{ quote: string; verdict: string }>;
  /** What the document does well, so the critique stays usable rather than cruel. */
  survives: string[];
  instruction: string;
}

/**
 * The blunt read. Deliberately a separate function from {@link scoreResume} rather than
 * a `tone: 'harsh'` flag: the honest critique quotes the actual line that fails, and
 * that is a different output shape, not a different adjective.
 */
export function roastResume(input: string): ResumeRoast {
  const parsed = parseResume(input);
  const score = scoreResume(input);
  const hits: ResumeRoast['hits'] = [];

  for (const bullet of parsed.bullets.filter((b) => b.weakOpener).slice(0, 4)) {
    hits.push({ quote: bullet.text.slice(0, 140), verdict: `"${bullet.weakOpener}" tells a reader you were in the room. It does not tell them what changed because you were.` });
  }
  for (const bullet of parsed.bullets.filter((b) => b.length > 220).slice(0, 2)) {
    hits.push({ quote: `${bullet.text.slice(0, 120)}…`, verdict: `${bullet.length} characters. Nobody finishes this sentence, including the person who has to decide about you.` });
  }
  const vague = parsed.bullets.filter((b) => !b.quantified && b.length < 60).slice(0, 3);
  for (const bullet of vague) {
    hits.push({ quote: bullet.text, verdict: 'Short and unquantified — this could be written by anyone who has held any version of this job.' });
  }
  if (!parsed.contact.email) hits.push({ quote: '(no email found)', verdict: 'The document does not contain an email address. Everything else here is academic.' });
  if (parsed.skillTokens.length < 5) hits.push({ quote: `(${parsed.skillTokens.length} recognised skills)`, verdict: 'A keyword filter has almost nothing to grab. You are being rejected by software before a person forms an opinion.' });

  const survives = score.strengths.slice(0, 3);
  return {
    score: score.overall,
    hits,
    survives,
    instruction: 'Deliver these findings bluntly but without contempt: every hit quotes the person\'s real text, so name the line and say what it costs them. Close with the strongest thing the document does (see `survives`) and the single highest-value fix. Never invent a flaw that is not in `hits`.',
  };
}

// ---------------------------------------------------------------------------
// Optimize
// ---------------------------------------------------------------------------

export interface ResumeEdit {
  kind: 'rewrite_bullet' | 'shorten_bullet' | 'quantify_bullet' | 'add_section' | 'normalize_dates' | 'add_skill';
  /** The exact text the edit applies to — quotable back into an apply call. */
  target: string;
  reason: string;
  /** What the replacement must preserve or contain. The caller writes the prose. */
  requirement: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ResumeOptimization {
  score: ResumeScore;
  edits: ResumeEdit[];
  /** Present only when a job description was supplied — the keywords to work in. */
  missingKeywords: string[];
  instruction: string;
}

/**
 * Produce the prioritised, anchored edit list.
 *
 * Each edit names the EXACT existing text, so the caller can quote it straight back
 * into an apply operation. Nothing here writes replacement prose: only the person (or
 * the model holding the conversation with them) knows what they actually did, and a
 * fabricated bullet on a résumé is a lie the candidate has to defend in a room.
 */
export function optimizeResume(input: string, jobDescription?: string): ResumeOptimization {
  const parsed = parseResume(input);
  const score = scoreResume(input);
  const edits: ResumeEdit[] = [];

  for (const bullet of parsed.bullets.filter((b) => b.weakOpener)) {
    edits.push({
      kind: 'rewrite_bullet',
      target: bullet.text,
      reason: `Opens with "${bullet.weakOpener}" — describes presence rather than result.`,
      requirement: `Rewrite starting with an ownership verb (${STRONG_VERBS.slice(0, 6).join(', ')}…). Keep every proper noun and number already in the line. Do not add a metric the person has not stated.`,
      priority: 'high',
    });
  }
  for (const bullet of parsed.bullets.filter((b) => b.length > 220)) {
    edits.push({
      kind: 'shorten_bullet',
      target: bullet.text,
      reason: `${bullet.length} characters — wraps past three lines and stops being read.`,
      requirement: 'Cut to under 180 characters. Every metric and proper noun must survive verbatim.',
      priority: 'medium',
    });
  }
  const unquantified = parsed.bullets.filter((b) => !b.quantified && !b.weakOpener).slice(0, 5);
  for (const bullet of unquantified) {
    edits.push({
      kind: 'quantify_bullet',
      target: bullet.text,
      reason: 'No number — the claim has no size.',
      requirement: 'Ask the person for the scale, delta or duration and add it. If they do not know it, leave the bullet unchanged rather than estimating.',
      priority: 'high',
    });
  }
  const kinds = new Set(parsed.sections.map((s) => s.kind));
  if (!kinds.has('summary')) edits.push({ kind: 'add_section', target: 'Summary', reason: 'No summary section.', requirement: 'Three sentences at the top: what they do, the scale, what they want next. Draw every fact from the existing document.', priority: 'high' });
  if (!kinds.has('skills')) edits.push({ kind: 'add_section', target: 'Skills', reason: 'No skills section, so keyword filters have nothing structured to read.', requirement: 'Group the tools and methods already named in the document. Add nothing they have not demonstrated.', priority: 'high' });
  const dateStyles = [...new Set(parsed.dates.map((d) => d.style))];
  if (dateStyles.length > 1) edits.push({ kind: 'normalize_dates', target: parsed.dates.map((d) => d.raw).join(' | '), reason: `${dateStyles.length} date formats in one document.`, requirement: 'Normalise every range to YYYY-MM, with "Present" for the current role.', priority: 'medium' });

  let missingKeywords: string[] = [];
  if (jobDescription && jobDescription.trim()) {
    const jobTokens = tokenCounts(jobDescription);
    const have = new Set(parsed.tokens);
    missingKeywords = [...jobTokens.entries()]
      .filter(([token, count]) => isSkillToken(token) && !have.has(token) && count >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([token]) => displaySkill(token));
    for (const keyword of missingKeywords.slice(0, 6)) {
      edits.push({
        kind: 'add_skill',
        target: keyword,
        reason: 'Named in the job description and absent from the résumé.',
        requirement: `Add "${keyword}" ONLY if the person has genuinely used it — then place it in the skills section and, where true, in the bullet where they used it. If they have not used it, leave it out and tell them it is a real gap.`,
        priority: 'high',
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 } as const;
  edits.sort((a, b) => order[a.priority] - order[b.priority]);
  return {
    score,
    edits,
    missingKeywords,
    instruction: 'Work through `edits` in order. For each one, quote `target` back to the person, say the `reason` in a sentence, and propose a replacement that satisfies `requirement`. Never assert a metric, employer or technology that is not already in their document or that they have not confirmed to you.',
  };
}

// ---------------------------------------------------------------------------
// Consolidate
// ---------------------------------------------------------------------------

export interface ResumeConsolidation {
  sourceCount: number;
  /** Bullets that appear in more than one source, with the duplicates grouped. */
  duplicateGroups: Array<{ canonical: string; variants: string[] }>;
  /** Bullets unique to one source — the content a merge would otherwise lose. */
  uniqueBullets: string[];
  mergedSkills: string[];
  instruction: string;
}

/** Similarity of two bullets by shared token proportion (0..1). */
function bulletSimilarity(a: ResumeBullet, b: ResumeBullet): number {
  const left = new Set(a.text.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const right = new Set(b.text.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * Merge several résumés into one master, without losing a line.
 *
 * The failure this prevents is the reason people keep four résumés instead of one: a
 * merge done by hand silently drops the bullet that only existed in the version they
 * did not have open. So this reports BOTH the overlap and the uniques, and never
 * discards anything on the caller's behalf.
 */
export function consolidateResumes(inputs: readonly string[]): ResumeConsolidation {
  const parsedAll = inputs.map(parseResume);
  const all = parsedAll.flatMap((p, index) => p.bullets.map((b) => ({ bullet: b, source: index })));
  const duplicateGroups: ResumeConsolidation['duplicateGroups'] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < all.length; i += 1) {
    if (consumed.has(i)) continue;
    const left = all[i];
    if (!left) continue;
    const variants: string[] = [];
    for (let j = i + 1; j < all.length; j += 1) {
      if (consumed.has(j)) continue;
      const right = all[j];
      if (!right) continue;
      if (left.source === right.source) continue;
      if (bulletSimilarity(left.bullet, right.bullet) >= 0.6) {
        consumed.add(j);
        variants.push(right.bullet.text);
      }
    }
    if (variants.length) {
      consumed.add(i);
      duplicateGroups.push({ canonical: left.bullet.text, variants });
    }
  }

  const uniqueBullets = all.filter((_, index) => !consumed.has(index)).map((entry) => entry.bullet.text);
  const mergedSkills = [...new Set(parsedAll.flatMap((p) => p.skillTokens))].map(displaySkill).sort();

  return {
    sourceCount: inputs.length,
    duplicateGroups,
    uniqueBullets,
    mergedSkills,
    instruction: 'Build ONE master résumé: for each duplicate group keep the strongest phrasing (the one with a number, or the ownership verb) and drop the rest; keep every bullet in `uniqueBullets` — those exist in only one source and are exactly what a hand-merge loses. Union the skills. Do not invent a bullet that appears in none of the sources.',
  };
}

// ---------------------------------------------------------------------------
// Profile audit
// ---------------------------------------------------------------------------

export interface ProfileAudit {
  score: number;
  /** Each field checked, whether it passed, and why it matters. */
  checks: Array<{ field: string; ok: boolean; detail: string; weight: number }>;
  missing: string[];
  instruction: string;
}

/**
 * Grade a PUBLIC "hire me" listing — the profile a visitor lands on, not the document.
 *
 * Scored against the fields `freelancer_profiles` actually stores, because a profile
 * audit that grades fields the product cannot hold is advice nobody can act on.
 */
export function auditProfile(profile: {
  headline?: string | null;
  bio?: string | null;
  skills?: readonly string[] | null;
  discipline?: string | null;
  hourlyRateCents?: number | null;
  location?: string | null;
  timezone?: string | null;
  avatarKey?: string | null;
  slug?: string | null;
  published?: boolean | null;
  availability?: string | null;
  resumeTitle?: string | null;
  /** Career intent — what employment this person is open to, when they have said. */
  seeking?: string | null;
  targetRoles?: readonly string[] | null;
}): ProfileAudit {
  const text = (v: unknown): string => String(v ?? '').trim();
  const checks: ProfileAudit['checks'] = [
    { field: 'headline', ok: text(profile.headline).length >= 12, weight: 16, detail: 'The headline is the only line that appears on every card and search result. Name the role and the outcome, not a job title alone.' },
    { field: 'bio', ok: text(profile.bio).length >= 120, weight: 14, detail: 'A bio under about 120 characters reads as unfinished. Two short paragraphs: what you do, and the proof.' },
    { field: 'skills', ok: (profile.skills?.length ?? 0) >= 5, weight: 14, detail: 'Skills drive every filter on the talent directory. Fewer than five and you are excluded from most searches.' },
    { field: 'discipline', ok: !!text(profile.discipline), weight: 8, detail: 'The discipline decides which category you appear under. Without it you appear under none.' },
    { field: 'avatar', ok: !!text(profile.avatarKey), weight: 8, detail: 'A profile with no picture is skipped in a grid of profiles that have one.' },
    { field: 'rate', ok: (profile.hourlyRateCents ?? 0) > 0, weight: 8, detail: 'A published rate filters out the wrong enquiries before they cost you a conversation.' },
    { field: 'location', ok: !!text(profile.location) || !!text(profile.timezone), weight: 6, detail: 'Location or timezone is how a client judges overlap. Neither present reads as unavailable.' },
    { field: 'slug', ok: !!text(profile.slug), weight: 6, detail: 'A vanity slug gives you a link you can put in an application. The generated URL is not memorable.' },
    { field: 'resume', ok: !!text(profile.resumeTitle), weight: 10, detail: 'No résumé attached, so an employer viewing the profile has nothing to forward internally.' },
    { field: 'published', ok: profile.published === true, weight: 10, detail: 'The profile is not published, so none of the above is visible to anyone.' },
  ];
  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.filter((c) => c.ok).reduce((sum, c) => sum + c.weight, 0);
  return {
    score: clamp((earned / total) * 100),
    checks,
    missing: checks.filter((c) => !c.ok).map((c) => c.field),
    instruction: 'Report the score, then walk the failed checks in weight order. For `headline` and `bio`, draft a concrete replacement from the profile\'s own skills and résumé evidence and offer it for approval — do not save it without one.',
  };
}
