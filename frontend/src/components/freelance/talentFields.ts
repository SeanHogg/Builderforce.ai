/**
 * The canonical option sets for a for-hire (talent) profile. Declared once so the
 * profile editor and the hired-account onboarding wizard can never drift apart.
 * Labels are resolved through the `freelancer.discipline.*` / `freelancer.availability.*`
 * i18n namespaces at render time (all 5 locales).
 */

export const TALENT_DISCIPLINES = [
  'developer', 'dba', 'designer', 'devops', 'qa', 'pm', 'data', 'security', 'other',
] as const;

export const TALENT_AVAILABILITIES = ['open', 'limited', 'unavailable'] as const;

/**
 * The CAREER half of the same listing (migration 0462).
 *
 * `seeking` is the one field that decides which kind of demand this listing is offered
 * to — project work, employment, or both — and the employment-only fields below are what
 * an employer's search matches on. Declared here beside the service fields for the same
 * reason those are: the editor, the onboarding wizard and any future card must not each
 * carry their own copy of the vocabulary.
 *
 * Kept in lockstep with `api/src/application/career/listing.ts`, which owns the same
 * enumerations server-side and is what actually validates a PATCH. Labels resolve through
 * the `freelancer.seeking.*`, `freelancer.seniority.*` and `freelancer.workMode.*` i18n
 * namespaces at render time (all 5 locales).
 */
export const TALENT_SEEKING_MODES = ['services', 'employment', 'both', 'not_looking'] as const;

export const TALENT_WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;

export const TALENT_SENIORITIES = [
  'junior', 'mid', 'senior', 'staff', 'lead', 'principal', 'director', 'executive',
] as const;
