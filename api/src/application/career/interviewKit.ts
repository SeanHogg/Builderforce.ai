/**
 * Interview preparation — the question set and the coaching loop.
 *
 * ── WHY THE QUESTIONS ARE DERIVED, NOT LISTED ────────────────────────────────────
 * A canned list of behavioural questions is worth nothing: everyone has read it,
 * including the interviewer. What a candidate cannot get anywhere else is the question
 * THIS posting implies — the one generated from the skill it repeats four times, and the
 * one aimed at the gap their own résumé has against it. So every question here is built
 * from a competency the posting actually names, and the hardest ones are aimed at the
 * overlap gap {@link compareResumeToJob} measured.
 *
 * ── THE NAME COLLISION THIS RESOLVES ─────────────────────────────────────────────
 * `interview` on the Creation Canvas means a CUSTOMER DISCOVERY interview — a founder
 * object, declared in the founder set. A job interview had no representation at all,
 * which meant "help me prepare for my interview" authored a customer-discovery card. The
 * kinds produced here are deliberately named `interviewPrep` so the two never collide.
 */

import { displaySkill, isSkillToken, tokenCounts } from './lexicon';
import { compareResumeToJob } from './jobMatch';
import { parseResume } from './resumeModel';

export type InterviewType = 'behavioral' | 'technical' | 'situational' | 'leadership' | 'screening';

export interface InterviewQuestion {
  question: string;
  category: string;
  type: InterviewType;
  /** Why this question is being asked of THIS candidate for THIS posting. */
  why: string;
  /** What a strong answer must contain — the rubric the coach scores against. */
  lookFor: string[];
  difficulty: 'warmup' | 'core' | 'hard';
}

export interface InterviewKit {
  role: string;
  type: InterviewType;
  questions: InterviewQuestion[];
  /** Skills the posting names that the résumé does not evidence — the exposed flank. */
  riskAreas: string[];
  instruction: string;
}

const COMPETENCY_TEMPLATES: Readonly<Record<InterviewType, ReadonlyArray<{ q: (subject: string) => string; category: string; lookFor: string[] }>>> = {
  behavioral: [
    { q: (s) => `Tell me about a time your work with ${s} did not go the way you expected. What did you do?`, category: 'Ownership', lookFor: ['A specific incident, not a policy', 'What they personally decided', 'The outcome, including the cost'] },
    { q: (s) => `Describe the hardest disagreement you had about ${s}. How did it resolve?`, category: 'Collaboration', lookFor: ['The other side stated fairly', 'A decision, not a compromise story', 'What they would do differently'] },
    { q: (s) => `Walk me through something you built with ${s} that you are proud of, and what it changed.`, category: 'Impact', lookFor: ['A measurable result', 'Their specific contribution', 'Why it mattered to the business'] },
  ],
  technical: [
    { q: (s) => `Walk me through how you would design something using ${s} for roughly ten times your current scale.`, category: 'Design', lookFor: ['Stated assumptions', 'A named trade-off', 'What they would measure'] },
    { q: (s) => `What goes wrong with ${s} in production that does not go wrong in development?`, category: 'Depth', lookFor: ['A real failure they have seen', 'The diagnosis path', 'The fix and its cost'] },
    { q: (s) => `How do you test work involving ${s}, and what do you deliberately not test?`, category: 'Judgement', lookFor: ['A coverage philosophy', 'An explicit trade-off', 'Evidence from a real codebase'] },
  ],
  situational: [
    { q: (s) => `Your ${s} work is two weeks late and the deadline is fixed. What do you do first?`, category: 'Prioritisation', lookFor: ['Who they tell, and when', 'What they cut', 'How they prevent a repeat'] },
    { q: (s) => `You inherit a ${s} system nobody understands and it breaks weekly. Your first thirty days?`, category: 'Diagnosis', lookFor: ['Stabilise before improve', 'How they build the map', 'What they refuse to do first'] },
  ],
  leadership: [
    { q: (s) => `How have you grown someone else's capability in ${s}?`, category: 'Development', lookFor: ['A named person and a change', 'What they delegated', 'How they measured it'] },
    { q: (s) => `Tell me about a decision on ${s} you made with incomplete information.`, category: 'Decision-making', lookFor: ['What was unknown', 'What would have changed their mind', 'The review afterwards'] },
  ],
  screening: [
    { q: (s) => `How much of your recent work has been hands-on with ${s}?`, category: 'Verification', lookFor: ['A proportion, not a yes', 'Recency', 'A concrete example'] },
    { q: () => 'What are you looking for in your next role, and what would make you turn this one down?', category: 'Motivation', lookFor: ['A real constraint', 'Consistency with their history', 'Honesty about compensation'] },
  ],
};

/**
 * Build an interview question set from a posting, optionally sharpened by the
 * candidate's own résumé so the hard questions land on the actual gap.
 */
export function buildInterviewKit(input: {
  jobDescription: string;
  role?: string;
  type?: InterviewType;
  count?: number;
  resumeText?: string;
}): InterviewKit {
  const type: InterviewType = input.type ?? 'behavioral';
  const count = Math.max(3, Math.min(10, input.count ?? 5));
  const jobCounts = tokenCounts(input.jobDescription);

  // The competencies the posting actually emphasises: recognised skills first, ordered
  // by how often the posting repeats them, then its most-repeated domain vocabulary.
  const skillSubjects = [...jobCounts.entries()]
    .filter(([token]) => isSkillToken(token))
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => displaySkill(token));
  const domainSubjects = [...jobCounts.entries()]
    .filter(([token, n]) => !isSkillToken(token) && n >= 3 && token.length > 4)
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token);
  const subjects = [...skillSubjects, ...domainSubjects];

  const riskAreas = input.resumeText
    ? compareResumeToJob(input.resumeText, input.jobDescription).overlap.missing.slice(0, 6)
    : [];

  const templates = COMPETENCY_TEMPLATES[type];
  const questions: InterviewQuestion[] = [];

  // Hard questions first in construction order — they target the gap, which is the part
  // a candidate most needs to have rehearsed before the room.
  for (const risk of riskAreas.slice(0, 2)) {
    questions.push({
      question: `This role leans on ${risk}. Talk me through your experience with it.`,
      category: 'Gap probe',
      type,
      why: `${risk} is named in the posting and does not appear anywhere in the résumé. This question is coming, and it is the one that decides the interview.`,
      lookFor: ['An honest boundary rather than a bluff', 'The nearest adjacent thing they HAVE done', 'A concrete plan to close it'],
      difficulty: 'hard',
    });
  }
  for (let i = 0; questions.length < count && i < templates.length * 3; i += 1) {
    // `i % templates.length` cannot miss, but the index signature does not know
    // that and a `!` here would be the assertion that hides the empty-catalogue
    // case. Skipping is the honest read: no template, no question.
    const template = templates[i % templates.length];
    if (!template) continue;
    const subject = subjects[Math.floor(i / templates.length) % Math.max(1, subjects.length)] ?? 'this role';
    const question = template.q(subject);
    if (questions.some((existing) => existing.question === question)) continue;
    questions.push({
      question,
      category: template.category,
      type,
      why: subjects.includes(subject)
        ? `The posting names "${subject}" repeatedly, so ${template.category.toLowerCase()} around it is fair game.`
        : `A standard ${template.category.toLowerCase()} probe for this level.`,
      lookFor: [...template.lookFor],
      difficulty: questions.length < 2 ? 'warmup' : 'core',
    });
  }

  return {
    role: input.role?.trim() || 'the advertised role',
    type,
    questions: questions.slice(0, count),
    riskAreas,
    instruction: 'Run these as a drill, one at a time: ask, wait for the person\'s real answer, then score it against `lookFor` and say specifically what was missing. Do not supply a model answer before they have tried — a rehearsed answer in someone else\'s words fails on the first follow-up.',
  };
}

// ---------------------------------------------------------------------------
// Coaching
// ---------------------------------------------------------------------------

export interface CoachingPlan {
  focus: string;
  /** The STAR-shaped scaffold, filled with the candidate's own evidence where present. */
  stories: Array<{ prompt: string; sourceBullet: string | null; missing: string[] }>;
  drills: Array<{ name: string; detail: string }>;
  instruction: string;
}

/**
 * Turn a candidate's own résumé into rehearsal material.
 *
 * The scaffold is filled from THEIR bullets, and every element the bullet does not
 * supply is listed as missing rather than invented — which is the whole difference
 * between preparing someone and writing them a script they cannot defend.
 */
export function buildCoachingPlan(input: { resumeText: string; jobDescription?: string; focus?: string }): CoachingPlan {
  const resume = parseResume(input.resumeText);
  const gap = input.jobDescription
    ? compareResumeToJob(input.resumeText, input.jobDescription).overlap.missing.slice(0, 4)
    : [];

  const candidates = [...resume.bullets]
    .sort((a, b) => Number(b.quantified) - Number(a.quantified) || Number(b.strongOpener) - Number(a.strongOpener))
    .slice(0, 5);

  const stories = candidates.map((bullet) => {
    const missing: string[] = [];
    if (!bullet.quantified) missing.push('Result — no number in the line, so the story currently ends without a size.');
    if (!bullet.strongOpener) missing.push('Action — the line does not say what they personally did.');
    missing.push('Situation and Task — a bullet never carries these; they have to be recalled.');
    return {
      prompt: `Build a STAR answer from: "${bullet.text.slice(0, 160)}"`,
      sourceBullet: bullet.text,
      missing,
    };
  });

  const drills: CoachingPlan['drills'] = [
    { name: 'Ninety-second cut', detail: 'Tell each story in ninety seconds. Anything that does not survive the cut was never load-bearing.' },
    { name: 'The follow-up', detail: 'After each answer, ask "what would you do differently?" — the question that separates a rehearsed story from a real one.' },
    { name: 'The number check', detail: 'Every story must contain one number the person can defend. If they cannot source it, remove it rather than soften it.' },
  ];
  if (gap.length) {
    drills.push({
      name: 'Gap answer',
      detail: `Rehearse the honest answer for ${gap.join(', ')}: what they have not done, the nearest thing they have, and how fast they have picked up comparable things before. Bluffing here is the most common single-question interview loss.`,
    });
  }

  return {
    focus: input.focus?.trim() || (gap.length ? `Closing the gap on ${gap.join(', ')}` : 'Turning résumé bullets into defensible stories'),
    stories,
    drills,
    instruction: 'Coach one story at a time. Ask the person for the Situation and Task the bullet cannot carry, then score the assembled answer. Never write the story for them — a story in your words collapses on the first follow-up question, in the room, where you are not.',
  };
}
