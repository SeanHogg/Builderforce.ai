import { useTranslations } from 'next-intl';

/**
 * The project-status vocabulary, in ONE place.
 *
 * `projects.status` is a Postgres enum (`project_status`, kernel schema) with four
 * values, and every surface that renders one needs the same two things: the list of
 * legal values (the status <select>) and the localized label for a stored value (the
 * details header, the portfolio health card). Both used to live inline in
 * `ProjectDetailsPanel`; the second surface that needed them is what turned that into
 * a duplicate, so the vocabulary moved here and the panel now reads it from here.
 *
 * The labels stay under the `projectDetails.status.*` i18n namespace — they are the
 * SAME strings, and re-keying them into a new namespace would fork one label into two
 * translations that can drift.
 *
 * No `'use client'`: every importer is already a client boundary, so the directive
 * would mark nothing (see `scripts/check-frontend-architecture.mjs`).
 */

export const PROJECT_STATUSES = ['active', 'completed', 'archived', 'on_hold'] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** True when `value` is one of the four enum values (so `t()` has a key for it). */
export function isProjectStatus(value: string | null | undefined): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value ?? '');
}

/**
 * Returns the localized label for a project status. Unknown/legacy values fall back to
 * a de-underscored form of the raw value rather than rendering a missing-key error, and
 * a missing status reads as 'active' (the column default).
 */
export function useProjectStatusLabel(): (value: string | null | undefined) => string {
  const t = useTranslations('projectDetails');
  return (value) => {
    const s = value ?? 'active';
    return isProjectStatus(s) ? t(`status.${s}`) : s.replace(/_/g, ' ');
  };
}
