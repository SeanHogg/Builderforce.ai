import { getTranslations } from 'next-intl/server';

import { resolveTaskStatusLabel, type StatusTranslator } from './taskStatusLabel';

/**
 * `(status) => label` bound to the active locale, for SERVER components and route
 * handlers — the `getTranslations()` counterpart to `useTaskStatusLabel()`.
 *
 * Separate module because `next-intl/server` is server-only and importing it from
 * the `'use client'` hook file is a build error; both delegate to the same
 * `resolveTaskStatusLabel` so the fallback rule is stated exactly once.
 */
export async function getTaskStatusLabel(): Promise<(status: string | null | undefined) => string> {
  const t = await getTranslations('taskStatus');
  return (status: string | null | undefined) =>
    resolveTaskStatusLabel(t as unknown as StatusTranslator, status);
}
