/**
 * The posting vocabularies the browser side needs, in ONE module.
 *
 * `EXPERIENCE_LEVELS`, `PROJECT_LENGTHS` and `JOB_SPECIALTIES` are declared in
 * `lib/freelancerApi.ts` beside the types they belong to; this re-exports them so a
 * component imports a vocabulary from a vocabulary module rather than reaching into the
 * transport client for a constant. It also holds the two things only the UI needs: the
 * message-key builders, so a label is derived from a value rather than typed out at each
 * `<option>`, and the coarse discipline list every talent surface already shares.
 *
 * A label is NEVER assembled here. Everything returns a KEY; `useTranslations` resolves
 * it, which is what keeps the five catalogues the single source of user-visible text.
 */
export {
  EXPERIENCE_LEVELS,
  PROJECT_LENGTHS,
  JOB_SPECIALTIES,
  type ExperienceLevel,
  type ProjectLength,
} from '@/lib/freelancerApi';

/** The coarse top level. Same nine values every talent surface filters on. */
export const JOB_DISCIPLINES = [
  'developer', 'dba', 'designer', 'devops', 'qa', 'pm', 'data', 'security', 'other',
] as const;

/** How the work is billed, as a pickable list. */
export const ENGAGEMENT_TYPES = ['fixed_bid', 'hourly', 'fte'] as const;

/** A screening question's answer shape. */
export const SCREENING_QUESTION_TYPES = ['text', 'yes_no', 'number'] as const;

/** Relative to the `freelancer` namespace: `freelancer.jobs.experience.<level>`.
 *  Rooted at `freelancer` rather than at `freelancer.jobs` because every surface that
 *  renders a seniority also renders a DISCIPLINE, which lives at `freelancer.discipline`
 *  — one translator per surface, not two into the same namespace. */
export const experienceKey = (level: string): string => `jobs.experience.${level}`;
/** Relative to the `freelancer` namespace: `freelancer.jobs.length.<value>`. */
export const projectLengthKey = (value: string): string => `jobs.length.${value}`;
/** `talent.specialty.<leaf>` — the label for a sub-category. */
export const specialtyKey = (leaf: string): string => `specialty.${leaf}`;
/** `talent.match.<code>` — why a recommendation ranked where it did. */
export const matchReasonKey = (code: string): string => `match.${code}`;
/** `talent.invite.status.<status>` — an invitation's state. */
export const inviteStatusKey = (status: string): string => `invite.status.${status}`;

/** Bytes → a short human size. Pure formatting of a number the API already returned;
 *  no unit word, so it needs no catalogue entry. */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '';
  const units = ['B', 'KB', 'MB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
