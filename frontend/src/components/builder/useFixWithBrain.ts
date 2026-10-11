// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useDockedBrain } from '@/lib/brain/dockedBrain';
import { formatBuildFailure, type BuildFailure } from '@/lib/buildDiagnostics';

/**
 * Hand one recorded failure to the docked Brain to fix — the stopped preview's
 * "Fix it for me" and a Problems row's fix button. It sends (the click IS the
 * person asking), and the message carries the failure exactly as recorded, so
 * Brain starts from the real error rather than a description of it.
 *
 * Null when the surface has no docked Brain: there is nobody to ask, so the
 * control should not exist.
 */
export function useFixWithBrain(): ((failure: BuildFailure) => void) | null {
  const t = useTranslations('ide.workspace');
  const docked = useDockedBrain();
  const instruction = t('fixPrompt');
  const fix = useCallback(
    (failure: BuildFailure) => docked?.ask(`${instruction}\n\n\`\`\`\n${formatBuildFailure(failure)}\n\`\`\``),
    [docked, instruction],
  );
  return docked ? fix : null;
}
