/**
 * Résumé ↔ posting comparison — the match, the tailoring plan, and the screening read.
 *
 * ── ONE COMPARISON, THREE AUDIENCES ──────────────────────────────────────────────
 * "Is it worth me applying?", "how do I rewrite this to fit?" and "should we interview
 * this person?" are the same overlap measured once and reported to three different
 * people. They are separate exported functions because the OUTPUT differs — a seeker
 * needs the gap and whether to bother, a tailoring pass needs the anchored edits, a
 * screener needs a defensible verdict against stated criteria — but they all call
 * {@link compareResumeToJob}, so a candidate and the employer looking at them can never
 * be shown two different match numbers for the same pair of documents.
 *
 * ── WHY SCREENING REFUSES UNSTATED CRITERIA ──────────────────────────────────────
 * `screenCandidate` scores ONLY against requirements the posting actually stated. That
 * mirrors the constraint written into the built-in Recruiter agent's own charter — it
 * "never advances or rejects a candidate on a criterion the posting did not state" — and
 * it is the difference between a screening tool and an automated way to launder a bias.
 */

import { displaySkill, isSkillToken, parseResume, skillGroupOf, tokenCounts, tokenSet } from '@builderforce/creation-canvas-contract';

export interface KeywordOverlap {
  /** Skill keywords the posting names that the résumé also contains. */
  matched: string[];
  /** Skill keywords the posting names that the résumé does not contain. */
  missing: string[];
  /** Non-skill terms the posting emphasises (repeated) and the résumé lacks. */
  missingContext: string[];
  /** Skills the résumé has that the posting did not ask for — the transferable surplus. */
  surplus: string[];
}

export interface JobMatch {
  /** 0..100. Skill overlap dominates; context terms and seniority adjust it. */
  score: number;
  verdict: 'strong' | 'worth applying' | 'stretch' | 'poor fit';
  overlap: KeywordOverlap;
  /** Per-area coverage, so "you are strong on data and thin on cloud" is answerable. */
  byArea: Array<{ area: string; required: number; matched: number; coverage: number }>;
  evidence: {
    requiredSkillCount: number;
    matchedSkillCount: number;
    resumeSkillCount: number;
  };
  instruction: string;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * The single overlap measurement every consumer in this module shares.
 *
 * Exported because the tailoring and screening readings need the same numbers; callers
 * outside this module should use the three named readings rather than this.
 */
export function compareResumeToJob(resumeText: string, jobText: string): JobMatch {
  const resume = parseResume(resumeText);
  const jobCounts = tokenCounts(jobText);
  const resumeTokens = new Set(resume.tokens);

  const requiredSkills = [...jobCounts.keys()].filter(isSkillToken);
  const matched = requiredSkills.filter((token) => resumeTokens.has(token));
  const missing = requiredSkills.filter((token) => !resumeTokens.has(token));

  // Non-skill terms the posting REPEATS are the ones it cares about (a domain word, a
  // methodology, a market). Mentioned once, a word is usually boilerplate.
  const missingContext = [...jobCounts.entries()]
    .filter(([token, count]) => !isSkillToken(token) && count >= 3 && !resumeTokens.has(token) && token.length > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([token]) => token);

  const jobSkillSet = new Set(requiredSkills);
  const surplus = resume.skillTokens.filter((token) => !jobSkillSet.has(token));

  const byAreaMap = new Map<string, { required: number; matched: number }>();
  for (const token of requiredSkills) {
    const area = skillGroupOf(token) ?? 'Other';
    const entry = byAreaMap.get(area) ?? { required: 0, matched: 0 };
    entry.required += 1;
    if (resumeTokens.has(token)) entry.matched += 1;
    byAreaMap.set(area, entry);
  }
  const byArea = [...byAreaMap.entries()]
    .map(([area, v]) => ({ area, required: v.required, matched: v.matched, coverage: clamp((v.matched / v.required) * 100) }))
    .sort((a, b) => b.required - a.required);

  // With no recognisable skill in the posting there is nothing to measure; say so with a
  // neutral score rather than inventing a confident number from prose overlap alone.
  const skillCoverage = requiredSkills.length === 0 ? null : matched.length / requiredSkills.length;
  const contextPenalty = Math.min(12, missingContext.length * 1.5);
  const score = skillCoverage === null
    ? 50
    : clamp(skillCoverage * 88 + Math.min(12, resume.skillTokens.length * 0.6) - contextPenalty);

  return {
    score,
    verdict: score >= 75 ? 'strong' : score >= 55 ? 'worth applying' : score >= 35 ? 'stretch' : 'poor fit',
    overlap: {
      matched: matched.map(displaySkill),
      missing: missing.map(displaySkill),
      missingContext,
      surplus: surplus.map(displaySkill),
    },
    byArea,
    evidence: {
      requiredSkillCount: requiredSkills.length,
      matchedSkillCount: matched.length,
      resumeSkillCount: resume.skillTokens.length,
    },
    instruction: requiredSkills.length === 0
      ? 'The posting names no recognisable skill, so this score is not a measurement — say so, and compare on the responsibilities in prose instead of quoting a number.'
      : 'Report the score with the counts behind it. Name the missing skills honestly: a gap the person genuinely has is information they need before spending an afternoon on an application, not something to talk them out of.',
  };
}

// ---------------------------------------------------------------------------
// Tailoring
// ---------------------------------------------------------------------------

export interface TailorPlan {
  match: JobMatch;
  /** Bullets ranked by how much of the posting's vocabulary they already carry. */
  bulletRelevance: Array<{ text: string; hits: string[]; score: number }>;
  /**
   * Skills the posting wants that the résumé LISTS but no bullet demonstrates.
   *
   * This is the most valuable finding in the whole tailoring pass and it only exists
   * because the naïve version of this function found nothing to promote on a résumé
   * that was obviously relevant: every one of the posting's skills was in the person's
   * Skills line and not one appeared in a single achievement. That document passes a
   * keyword filter and dies in the interview, and neither the candidate nor a
   * keyword-matching tool can see why.
   */
  claimedButUnevidenced: string[];
  /** The concrete, anchored moves. Ordered: reorder, then emphasise, then flag gaps. */
  moves: Array<{
    kind: 'lead_with' | 'emphasise' | 'add_keyword' | 'declare_gap' | 'evidence_claim';
    target: string;
    reason: string;
    requirement: string;
  }>;
  instruction: string;
}

/**
 * Build the tailoring plan for one résumé against one posting.
 *
 * Deliberately returns a PLAN rather than rewritten text. The rewrite that matters is
 * the one the person can defend in an interview, and only they know which of their
 * bullets is really about the thing the posting is asking for. Every move names the
 * exact existing line so the caller can quote it back.
 */
export function tailorResume(resumeText: string, jobText: string): TailorPlan {
  const match = compareResumeToJob(resumeText, jobText);
  const resume = parseResume(resumeText);
  const jobSkills = new Set(tokenSet(jobText).filter(isSkillToken));

  const bulletRelevance = resume.bullets
    .map((bullet) => {
      const hits = tokenSet(bullet.text).filter((token) => jobSkills.has(token)).map(displaySkill);
      return {
        text: bullet.text,
        hits,
        score: clamp(hits.length * 25 + (bullet.quantified ? 20 : 0) + (bullet.strongOpener ? 10 : 0)),
      };
    })
    .sort((a, b) => b.score - a.score);

  // A skill the posting wants, present in the document (so the match counted it) and
  // absent from every bullet. See the field's note: this is the document that passes the
  // filter and loses the room.
  const evidencedInBullets = new Set(
    bulletRelevance.flatMap((bullet) => tokenSet(bullet.text).filter((token) => jobSkills.has(token))),
  );
  const claimedButUnevidenced = [...jobSkills]
    .filter((token) => resume.tokens.includes(token) && !evidencedInBullets.has(token))
    .map(displaySkill);

  const moves: TailorPlan['moves'] = [];
  for (const skill of claimedButUnevidenced.slice(0, 5)) {
    moves.push({
      kind: 'evidence_claim',
      target: skill,
      reason: `The posting asks for ${skill}, the résumé lists it, and no achievement bullet shows it being used. This document passes the keyword filter and then has nothing to say when they ask about it.`,
      requirement: `Ask what they actually DID with ${skill} — the system, the scale, the outcome — and turn the answer into one bullet under the relevant role. If it turns out they have only read about it, take it out of the skills list rather than leaving it there to be asked about.`,
    });
  }

  const leaders = bulletRelevance.filter((b) => b.hits.length > 0).slice(0, 3);
  for (const bullet of leaders) {
    moves.push({
      kind: 'lead_with',
      target: bullet.text,
      reason: `Already carries ${bullet.hits.length} of the posting's skills (${bullet.hits.join(', ')}).`,
      requirement: 'Move this bullet to the top of its section. Do not change its wording — it is already the strongest evidence for this posting.',
    });
  }
  for (const bullet of bulletRelevance.filter((b) => b.hits.length > 0 && !b.text.match(/\d/)).slice(0, 3)) {
    moves.push({
      kind: 'emphasise',
      target: bullet.text,
      reason: 'Relevant to this posting but carries no number, so it reads as a claim rather than a result.',
      requirement: 'Ask the person for the scale or delta and add it. If they do not have it, leave the line as written.',
    });
  }
  for (const keyword of match.overlap.missing.slice(0, 8)) {
    moves.push({
      kind: 'add_keyword',
      target: keyword,
      reason: 'Named in the posting and absent from the résumé.',
      requirement: `Ask whether they have used ${keyword}. If yes, work it into the bullet where they used it AND the skills section. If no, do not add it anywhere — put it in the gap list instead.`,
    });
  }
  for (const keyword of match.overlap.missing.slice(8, 14)) {
    moves.push({
      kind: 'declare_gap',
      target: keyword,
      reason: 'Required by the posting, absent from the résumé, and beyond the top eight to work in.',
      requirement: 'Tell the person plainly that this is a real gap for this role, and whether it is the kind that rules them out or the kind that is learned on the job.',
    });
  }

  return {
    match,
    bulletRelevance: bulletRelevance.slice(0, 15),
    claimedButUnevidenced,
    moves,
    instruction: 'Apply the moves in order, then produce the tailored résumé as a canvas `resume` object so it can be edited and exported. Every sentence must trace to something already in their document or something they confirmed in this conversation. A tailored résumé containing a skill the person does not have is a trap you set for them in the interview.',
  };
}

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------

export interface ScreeningResult {
  match: JobMatch;
  /** One row per STATED requirement, with the evidence found or its absence. */
  criteria: Array<{ requirement: string; met: boolean; evidence: string | null }>;
  metCount: number;
  totalCount: number;
  recommendation: 'advance' | 'hold' | 'reject' | 'insufficient_criteria';
  /** Why the recommendation is what it is — the audit trail for the decision. */
  rationale: string;
  instruction: string;
}

/**
 * Screen a candidate's résumé against a posting's STATED requirements.
 *
 * `requirements` is the posting's acceptance criteria, one per line — the same free-text
 * field `job_postings.requirements` already stores and the proposal evaluator already
 * judges against. With none supplied this returns `insufficient_criteria` rather than a
 * verdict: a screening decision against unstated criteria is not a screening decision.
 */
export function screenCandidate(
  resumeText: string,
  jobText: string,
  requirements: string,
): ScreeningResult {
  const match = compareResumeToJob(resumeText, jobText);
  const resume = parseResume(resumeText);
  const resumeTokens = new Set(resume.tokens);

  const lines = String(requirements ?? '')
    .split(/\n+/)
    .map((line) => line.replace(/^[\s\-–—•*\d.)]+/, '').trim())
    .filter((line) => line.length >= 8);

  const criteria = lines.map((requirement) => {
    const wanted = tokenSet(requirement).filter(isSkillToken);
    const hit = wanted.filter((token) => resumeTokens.has(token));
    // A requirement naming no recognisable skill can only be judged on prose overlap;
    // report it as unmet-with-no-evidence rather than guessing in the candidate's favour.
    const met = wanted.length > 0 && hit.length >= Math.ceil(wanted.length / 2);
    const evidence = met
      ? resume.bullets.find((b) => hit.some((token) => tokenSet(b.text).includes(token)))?.text
        ?? `Skills present in the document: ${hit.map(displaySkill).join(', ')}`
      : null;
    return { requirement, met, evidence };
  });

  const metCount = criteria.filter((c) => c.met).length;
  const totalCount = criteria.length;
  const ratio = totalCount ? metCount / totalCount : 0;
  const recommendation: ScreeningResult['recommendation'] = totalCount === 0
    ? 'insufficient_criteria'
    : ratio >= 0.7 ? 'advance'
      : ratio >= 0.4 ? 'hold'
        : 'reject';

  return {
    match,
    criteria,
    metCount,
    totalCount,
    recommendation,
    rationale: totalCount === 0
      ? 'The posting states no acceptance criteria, so there is nothing to screen against. Advancing or rejecting here would be a judgement on something the posting never asked for.'
      : `${metCount} of ${totalCount} stated requirements have supporting evidence in the document (${Math.round(ratio * 100)}%), and the résumé covers ${match.evidence.matchedSkillCount} of ${match.evidence.requiredSkillCount} skills named in the description.`,
    instruction: 'Report the recommendation with the criteria table behind it. Judge ONLY the stated requirements: do not infer seniority from graduation years, availability from location, or fit from anything the posting did not ask for. An unmet criterion with no evidence is "not demonstrated in this document", not "the candidate lacks it".',
  };
}

// ---------------------------------------------------------------------------
// Skill extraction
// ---------------------------------------------------------------------------

export interface ExtractedSkills {
  source: 'resume' | 'job';
  /** Grouped the way a skills section is written, so the output is paste-ready. */
  groups: Array<{ group: string; skills: string[] }>;
  flat: string[];
  /** Terms that repeat but are not in the known lexicon — candidate domain vocabulary. */
  unrecognisedTerms: string[];
  total: number;
}

/**
 * Pull every distinct skill out of a résumé or a job description.
 *
 * `unrecognisedTerms` is the honest half: the lexicon does not know every domain's
 * vocabulary, and a tool that silently drops the six repeated words it did not
 * recognise looks confident while missing the point of the posting.
 */
export function extractSkills(text: string, source: 'resume' | 'job' = 'resume'): ExtractedSkills {
  const counts = tokenCounts(text);
  const grouped = new Map<string, string[]>();
  const flat: string[] = [];
  for (const token of counts.keys()) {
    if (!isSkillToken(token)) continue;
    const group = skillGroupOf(token) ?? 'Other';
    const label = displaySkill(token);
    grouped.set(group, [...(grouped.get(group) ?? []), label]);
    flat.push(label);
  }
  const unrecognisedTerms = [...counts.entries()]
    .filter(([token, count]) => !isSkillToken(token) && count >= 3 && token.length > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([token]) => token);

  return {
    source,
    groups: [...grouped.entries()]
      .map(([group, skills]) => ({ group, skills: [...new Set(skills)].sort() }))
      .sort((a, b) => b.skills.length - a.skills.length),
    flat: [...new Set(flat)].sort(),
    unrecognisedTerms,
    total: new Set(flat).size,
  };
}
