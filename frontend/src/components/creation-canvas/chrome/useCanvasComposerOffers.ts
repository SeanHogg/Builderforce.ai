// No `'use client'`: this module exports hooks, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ComposerStarters, ComposerSuggestion } from '@/components/ChatInput';
import { applyTemplateEntry } from '@/lib/templates/apply';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';
import { PHASE_STARTERS, categoryServesPhase, phaseStarterKeys } from '@/lib/canvasPhaseStarters';
import { composerNextSteps } from '@/lib/composerNextSteps';
import { canvasSurfaceDefinition, type CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { useCanvasPhase } from '../phase/CanvasPhaseContext';

/**
 * What the canvas OFFERS its composer — data for the two affordances every prompt has
 * (`ChatInput`'s `starters` and `suggestions`), never a control of its own.
 *
 * ── STARTING POINTS, LED BY THE PHASE ────────────────────────────────────────────
 * The `+` row names the phase ("Starting points · Measure") and the catalogue opens on
 * the phase's three starters (`PHASE_STARTERS`), then the use cases that serve it
 * (`categoryServesPhase`), then everything else. Picking dispatches through
 * `applyTemplateEntry`: a prompt seeds the box, a pack lands on the board, an
 * installable template opens its guided setup.
 */
export function useCanvasStarters({ onPrompt, onTwilioJourney, onPack }: {
  /** Seed the composer. */
  onPrompt: (prompt: string) => void;
  /** The Twilio journey was picked — the vendor setup prompt joins the bar. */
  onTwilioJourney: (selected: boolean) => void;
  /** Land an object pack on the board. */
  onPack: (template: CreationTemplate) => void;
}): ComposerStarters {
  const t = useTranslations('creationCanvas');
  const tn = useTranslations('nav');
  const router = useRouter();
  const phase = useCanvasPhase()?.phase;
  const phaseName = phase ? tn(`stage.${phase}` as 'stage.idea') : null;
  const label = phaseName ? t('startingPointsFor', { phase: phaseName }) : t('startingPoints');

  const lead = useMemo(() => (phase ? {
    heading: label,
    items: PHASE_STARTERS[phase].map((starter) => {
      const keys = phaseStarterKeys(phase, starter.key);
      return {
        id: `${phase}:${starter.key}`,
        label: t(keys.labelKey as 'phaseStarters.idea.capture.label'),
        onSelect: () => onPrompt(t(keys.promptKey as 'phaseStarters.idea.capture.prompt')),
      };
    }),
  } : undefined), [label, onPrompt, phase, t]);
  const preferCategory = useCallback((category: string) => (phase ? categoryServesPhase(category, phase) : false), [phase]);

  return useMemo<ComposerStarters>(() => ({
    label,
    ...(lead ? { lead, preferCategory } : {}),
    onSelect: (entry) => applyTemplateEntry(entry, {
      onPrompt: (prompt) => {
        onPrompt(prompt);
        if (entry.id === 'twilio-ai-journey') onTwilioJourney(true);
      },
      onPack,
      onInstall: (key) => router.push(`/templates?open=${encodeURIComponent(key)}`),
    }),
  }), [label, lead, preferCategory, onPrompt, onTwilioJourney, onPack, router]);
}

/**
 * NEXT STEPS once a conversation has started: the surface's own fixed list, else the
 * phase's starters (`lib/composerNextSteps.ts`). Absent before the first turn — the
 * starting points are the way in then.
 */
export function useCanvasNextSteps({ surface, conversationStarted, onPrompt }: {
  surface: CanvasSurfaceId;
  conversationStarted: boolean;
  onPrompt: (prompt: string) => void;
}): readonly ComposerSuggestion[] | undefined {
  const t = useTranslations('creationCanvas');
  const phase = useCanvasPhase()?.phase;
  return useMemo(() => {
    if (!conversationStarted) return undefined;
    return composerNextSteps(canvasSurfaceDefinition(surface), phase).map((step) => ({
      id: step.id,
      label: t(step.labelKey as 'startingPoints'),
      onSelect: () => onPrompt(t(step.promptKey as 'startingPoints')),
    }));
  }, [conversationStarted, surface, phase, t, onPrompt]);
}
