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
