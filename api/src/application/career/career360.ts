/**
 * Career 360 — "pick where you want to go, see the gap and the plan to get there."
 *
 * ── WHY TARGETS ARE SUGGESTED FROM EVIDENCE, NOT ASPIRATION ──────────────────────
 * The useful version of this question is not "what do you want to be" — the person
 * already knows, and if that were enough they would not be asking. It is "given what you
 * can already evidence, which destinations are one step away, which are two, and what
 * exactly is missing for each". So targets are ranked by the overlap between the role's
 * declared skill profile and the skills the person's own document actually contains, and
 * every gap is named as a specific skill rather than a competency adjective.
 *
 * ── THE PLAN ENDS IN OBJECTS, NOT ADVICE ─────────────────────────────────────────
 * A gap plan that terminates in "consider learning Kubernetes" changes nothing. Each
 * step here names the artifact that closes it — a `practice` set, a `course`, a portfolio
 * `build`, a listing update — so the calling surface can author the thing rather than
 * describe it. That is the whole difference between a career tool and a horoscope.
 */

import { SKILL_GROUPS, displaySkill, isSkillToken, parseResume, tokenSet } from '@builderforce/creation-canvas-contract';

export interface RoleProfile {
  id: string;
  title: string;
  family: string;
  /** Canonical skill tokens that define the role. Core carries more weight than adjacent. */
  core: readonly string[];
  adjacent: readonly string[];
  /** Typical seniority ladder position, used to frame the move as up / across. */
  level: 'entry' | 'mid' | 'senior' | 'lead';
}

/**
 * The destinations Career 360 can reason about.
 *
 * Declared as DATA rather than branches so a new destination is one row — the same
 * open/closed rule the rest of this platform's registries follow. Every token here must
 * exist in the shared lexicon, which the module's test asserts.
 */
export const ROLE_PROFILES: readonly RoleProfile[] = [
  { id: 'frontend-engineer', title: 'Frontend Engineer', family: 'Engineering', level: 'mid', core: ['javascript', 'typescript', 'react', 'accessibility'], adjacent: ['nextjs', 'vue', 'tailwind', 'graphql', 'userexperience'] },
  { id: 'backend-engineer', title: 'Backend Engineer', family: 'Engineering', level: 'mid', core: ['api', 'sql', 'postgresql', 'rest'], adjacent: ['nodejs', 'python', 'java', 'go', 'redis', 'kafka', 'microservices'] },
  { id: 'fullstack-engineer', title: 'Full-stack Engineer', family: 'Engineering', level: 'mid', core: ['javascript', 'typescript', 'react', 'api', 'sql'], adjacent: ['nodejs', 'postgresql', 'docker', 'nextjs'] },
  { id: 'devops-engineer', title: 'DevOps / Platform Engineer', family: 'Engineering', level: 'senior', core: ['docker', 'kubernetes', 'cicd', 'terraform'], adjacent: ['aws', 'azure', 'googlecloud', 'linux', 'observability', 'sre'] },
  { id: 'sre', title: 'Site Reliability Engineer', family: 'Engineering', level: 'senior', core: ['sre', 'observability', 'kubernetes', 'linux'], adjacent: ['terraform', 'cicd', 'python', 'incidentresponse'] },
  { id: 'data-engineer', title: 'Data Engineer', family: 'Data', level: 'mid', core: ['sql', 'etl', 'airflow', 'python'], adjacent: ['dbt', 'snowflake', 'bigquery', 'spark', 'kafka', 'databricks'] },
  { id: 'data-analyst', title: 'Data Analyst', family: 'Data', level: 'entry', core: ['sql', 'analytics'], adjacent: ['python', 'bigquery', 'experimentation', 'dbt'] },
  { id: 'data-scientist', title: 'Data Scientist', family: 'Data', level: 'senior', core: ['python', 'machinelearning', 'sql'], adjacent: ['pytorch', 'tensorflow', 'pandas', 'numpy', 'experimentation'] },
  { id: 'qa-engineer', title: 'QA / Test Engineer', family: 'Engineering', level: 'entry', core: ['qualityassurance', 'tdd'], adjacent: ['javascript', 'python', 'cicd', 'api'] },
  { id: 'product-manager', title: 'Product Manager', family: 'Product', level: 'mid', core: ['productmanagement', 'roadmapping', 'analytics'], adjacent: ['userresearch', 'experimentation', 'stakeholdermanagement', 'agile'] },
  { id: 'product-designer', title: 'Product Designer', family: 'Design', level: 'mid', core: ['userexperience', 'figma', 'prototyping'], adjacent: ['userresearch', 'wireframing', 'accessibility', 'userinterface'] },
  { id: 'engineering-manager', title: 'Engineering Manager', family: 'Leadership', level: 'lead', core: ['peoplemanagement', 'mentoring', 'hiring'], adjacent: ['agile', 'stakeholdermanagement', 'roadmapping', 'facilitation'] },
  { id: 'solutions-architect', title: 'Solutions Architect', family: 'Engineering', level: 'lead', core: ['microservices', 'api', 'aws'], adjacent: ['kubernetes', 'terraform', 'postgresql', 'stakeholdermanagement'] },
  { id: 'security-engineer', title: 'Security Engineer', family: 'Engineering', level: 'senior', core: ['compliance', 'observability', 'linux'], adjacent: ['python', 'kubernetes', 'incidentresponse', 'cicd'] },
  { id: 'technical-writer', title: 'Technical Writer', family: 'Content', level: 'entry', core: ['technicalwriting', 'api'], adjacent: ['accessibility', 'python', 'javascript'] },
  { id: 'customer-success', title: 'Customer Success Manager', family: 'Commercial', level: 'mid', core: ['crm', 'saas', 'stakeholdermanagement'], adjacent: ['analytics', 'b2b', 'negotiation', 'facilitation'] },
  { id: 'account-executive', title: 'Account Executive', family: 'Commercial', level: 'mid', core: ['b2b', 'crm', 'negotiation'], adjacent: ['saas', 'forecasting', 'salesforce', 'hubspot'] },
  { id: 'marketing-manager', title: 'Marketing Manager', family: 'Commercial', level: 'mid', core: ['contentmarketing', 'analytics', 'seo'], adjacent: ['socialmedia', 'experimentation', 'hubspot', 'b2b'] },
  { id: 'business-analyst', title: 'Business Analyst', family: 'Product', level: 'entry', core: ['analytics', 'sql', 'stakeholdermanagement'], adjacent: ['agile', 'forecasting', 'budgeting'] },
  { id: 'scrum-master', title: 'Scrum Master / Delivery Lead', family: 'Delivery', level: 'mid', core: ['agile', 'scrum', 'facilitation'], adjacent: ['kanban', 'stakeholdermanagement', 'roadmapping', 'coaching'] },
];

export interface TargetSuggestion {
  role: RoleProfile;
  /** 0..100 readiness against the role's declared profile. */
  readiness: number;
  have: string[];
  missing: string[];
  /** How far the move is, in plain words. */
  distance: 'ready now' | 'one gap away' | 'a season away' | 'a genuine change';
}

export interface Career360Targets {
  /** Skills read out of the person's own document — the basis of every ranking. */
  evidencedSkills: string[];
  suggestions: TargetSuggestion[];
  instruction: string;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Rank every declared destination by what the person can already evidence. */
export function suggestTargets(resumeText: string, limit = 6): Career360Targets {
  const resume = parseResume(resumeText);
  const have = new Set(resume.skillTokens);

  const suggestions = ROLE_PROFILES.map((role) => {
    const coreHave = role.core.filter((token) => have.has(token));
    const adjacentHave = role.adjacent.filter((token) => have.has(token));
    const coreShare = role.core.length ? coreHave.length / role.core.length : 0;
    const adjacentShare = role.adjacent.length ? adjacentHave.length / role.adjacent.length : 0;
    const readiness = clamp(coreShare * 74 + adjacentShare * 26);
    const missingCore = role.core.filter((token) => !have.has(token));
    return {
      role,
      readiness,
      have: [...coreHave, ...adjacentHave].map(displaySkill),
      missing: [...missingCore, ...role.adjacent.filter((t) => !have.has(t))].slice(0, 8).map(displaySkill),
      distance: (missingCore.length === 0 ? 'ready now'
        : missingCore.length === 1 ? 'one gap away'
          : missingCore.length === 2 ? 'a season away'
            : 'a genuine change') as TargetSuggestion['distance'],
    };
  })
    .sort((a, b) => b.readiness - a.readiness)
    .slice(0, Math.max(1, Math.min(12, limit)));

  return {
    evidencedSkills: resume.skillTokens.map(displaySkill),
    suggestions,
    instruction: 'Lead with the two or three destinations that are "ready now" or "one gap away" — those are the ones worth acting on this month — and name the single missing skill for each. Say plainly that this ranking is computed from what the RÉSUMÉ evidences, so a skill they have but never wrote down is invisible here and the fix is to write it down. Then ask which target they want, and call the target plan.',
  };
}

export interface Career360Plan {
  target: RoleProfile;
  readiness: number;
  have: string[];
  missing: string[];
  /** Ordered steps, each naming the artifact that closes it. */
  steps: Array<{
    order: number;
    title: string;
    detail: string;
    /** The canvas object kind this step should produce, so the plan is buildable. */
    produces: string;
    horizon: 'this week' | 'this month' | 'this quarter';
  }>;
  instruction: string;
}

/** Build the gap-closing plan for one chosen destination. */
export function planForTarget(resumeText: string, targetId: string): Career360Plan | { error: string; availableTargets: string[] } {
  const target = ROLE_PROFILES.find((role) => role.id === targetId)
    ?? ROLE_PROFILES.find((role) => role.title.toLowerCase() === String(targetId).toLowerCase().trim());
  if (!target) {
    return {
      error: `No declared target role matches "${targetId}".`,
      availableTargets: ROLE_PROFILES.map((role) => role.id),
    };
  }
  const resume = parseResume(resumeText);
  const have = new Set(resume.skillTokens);
  const coreHave = target.core.filter((token) => have.has(token));
  const missingCore = target.core.filter((token) => !have.has(token));
  const missingAdjacent = target.adjacent.filter((token) => !have.has(token));
  const readiness = clamp(
    (target.core.length ? coreHave.length / target.core.length : 0) * 74
    + (target.adjacent.length ? target.adjacent.filter((t) => have.has(t)).length / target.adjacent.length : 0) * 26,
  );

  const steps: Career360Plan['steps'] = [];
  let order = 1;
  steps.push({
    order: order++,
    title: 'Make what you already have visible',
    detail: `Your document evidences ${coreHave.length} of ${target.core.length} core skills for ${target.title} (${coreHave.map(displaySkill).join(', ') || 'none yet'}). Before learning anything new, rewrite the summary and skills section so a screener filtering for ${target.title} finds them in the first ten seconds.`,
    produces: 'resume',
    horizon: 'this week',
  });
  if (missingCore.length) {
    steps.push({
      order: order++,
      title: `Close the core gap: ${missingCore.map(displaySkill).join(', ')}`,
      detail: `These are the skills the role is defined by — a listing for ${target.title} that omits all of them is rare. Study each to the point where you can answer a hostile follow-up, not to the point where you have watched a video.`,
      produces: 'practice',
      horizon: missingCore.length > 2 ? 'this quarter' : 'this month',
    });
    steps.push({
      order: order++,
      title: 'Build one thing that proves it',
      detail: `A claim on a résumé about ${missingCore.map(displaySkill).join(' / ')} is worth what the reader assumes; a working artifact they can open is worth what they can see. Build one small, finished, public thing that uses it.`,
      produces: 'build',
      horizon: 'this month',
    });
  }
  if (missingAdjacent.length) {
    steps.push({
      order: order++,
      title: `Pick up one adjacent skill: ${missingAdjacent.slice(0, 3).map(displaySkill).join(', ')}`,
      detail: 'Adjacent skills rarely decide a rejection on their own, but they are what turns "could do the job" into "has done the job". One is enough; three is procrastination.',
      produces: 'course',
      horizon: 'this quarter',
    });
  }
  steps.push({
    order: order++,
    title: 'Point the public listing at the target',
    detail: `Your "hire me" listing is what a recruiter searching for ${target.title} actually queries. Set the headline, discipline and skills to the destination rather than the history, and state the employment you are open to.`,
    produces: 'profile',
    horizon: 'this week',
  });
  steps.push({
    order: order++,
    title: 'Apply while you close the gap, not after',
    detail: `At ${readiness}% readiness, applications are information: the interviews tell you which gap is actually disqualifying and which one nobody asks about. Waiting until the plan is finished costs a season and teaches nothing.`,
    produces: 'jobApplication',
    horizon: 'this week',
  });

  return {
    target,
    readiness,
    have: coreHave.map(displaySkill),
    missing: [...missingCore, ...missingAdjacent].map(displaySkill),
    steps,
    instruction: 'Walk the steps in order and BUILD each artifact named in `produces` rather than describing it — the résumé revision, the practice set, the listing update, the applications. A plan that ends as a list of advice is the failure mode of every career tool ever shipped.',
  };
}

/** Every skill token the role catalogue references — used by the module's own test. */
export function declaredRoleSkillTokens(): string[] {
  return [...new Set(ROLE_PROFILES.flatMap((role) => [...role.core, ...role.adjacent]))];
}

/** The skill areas a target belongs to, for grouping a plan's study material. */
export function areasForTarget(target: RoleProfile): string[] {
  const areas = new Set<string>();
  for (const [group, tokens] of Object.entries(SKILL_GROUPS)) {
    if (target.core.some((token) => tokens.includes(token))) areas.add(group);
  }
  return [...areas];
}

/** True when a free-text term names a skill the lexicon knows — used to validate input. */
export function isKnownSkillPhrase(phrase: string): boolean {
  return tokenSet(phrase).some(isSkillToken);
}
