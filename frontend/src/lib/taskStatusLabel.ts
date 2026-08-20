'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { humanizeStatus } from './taskStatus';

/** The shape both next-intl translators share, narrowed to what a label needs. */
export interface StatusTranslator {
  (key: string): string;
  has(key: string): boolean;
}

/**
 * Display label for any status or swimlane key.
 *
 * ONE resolution rule, stated once: a canonical status resolves from the
 * `taskStatus.*` catalog; a custom swimlane key — operator-authored, so it has no
 * catalog entry by construction — falls back to the humanized key. Every board,
 * lane editor, briefcase badge and lifecycle panel used to spell some part of
 * this out itself, which is how three of them ended up with the *English*
 * constant map and one with a half-migrated `pm.epicStatus` lookup.
 *
 * Takes the translator rather than calling a hook so the server binder below and
 * the client hook share this function instead of restating it.
 */
export function resolveTaskStatusLabel(t: StatusTranslator, status: string | null | undefined): string {
  if (!status) return '—';
  return t.has(status) ? t(status) : humanizeStatus(status);
}

/**
 * `(status) => label` bound to the active locale, for client components.
 *
 * @example
 *   const statusLabel = useTaskStatusLabel();
 *   <span>{statusLabel(task.status)}</span>
 */
export function useTaskStatusLabel(): (status: string | null | undefined) => string {
  const t = useTranslations('taskStatus');
  return useCallback(
    (status: string | null | undefined) => resolveTaskStatusLabel(t as unknown as StatusTranslator, status),
    [t],
  );
}
