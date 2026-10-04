// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatMode } from '@/lib/brain';

/**
 * Which words a surface uses for the two conversation modes. The modes are the
 * same everywhere (`chat` / `work`); only their names differ, as catalog DATA:
 * - `default` — `brain.modes`: Chat / Work, for the Brain, the board and the canvas.
 * - `build`   — `brain.buildModes`: Ask / Build, beside a project being built,
 *   where "Work" said nothing about the thing on screen.
 */
export type ChatModeVocabulary = 'default' | 'build';

/** The vocabulary for a Brain capability surface: the build surface says Ask / Build. */
export function modeVocabularyFor(surface: string | undefined): ChatModeVocabulary {
  return surface === 'build' ? 'build' : 'default';
}

export interface ChatModeCopy {
  label: (mode: ChatMode) => string;
  hint: (mode: ChatMode) => string;
  /** The control's accessible name ("Conversation mode"), the same on every surface. */
  pickerAria: string;
}

/** The ONE reader of mode names — the `/` menu, its trigger and the empty-state toggle all use it. */
export function useChatModeCopy(vocabulary: ChatModeVocabulary = 'default'): ChatModeCopy {
  const general = useTranslations('brain.modes');
  const build = useTranslations('brain.buildModes');
  return useMemo<ChatModeCopy>(() => {
    const t = vocabulary === 'build' ? build : general;
    return {
      label: (mode) => t(`${mode}.label`),
      hint: (mode) => t(`${mode}.hint`),
      pickerAria: general('pickerAria'),
    };
  }, [vocabulary, general, build]);
}
