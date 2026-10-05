import { memo, useCallback, useId, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PromptUseCaseCatalog } from '@/components/PromptUseCasePicker';
import { Icon } from '@/components/ui/Icon';
import { applyTemplateEntry } from '@/lib/templates/apply';
import type { CreationTemplate } from '@/lib/templates/creationTemplates';
import { useDismissOnOutsidePress } from '@/lib/useDismissable';
import { PHASE_STARTERS, categoryServesPhase, phaseStarterKeys } from '@/lib/canvasPhaseStarters';
import { useCanvasPhase } from '../phase/CanvasPhaseContext';
import styles from '../CreationCanvas.module.css';

export interface CanvasPromptStarterProps {
  /** Whether the catalogue is open. The host owns it: the `+` menu opens it too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The conversation already has turns. The trigger then stands down — the way in is
   * the `+` menu's "Starting points" row — because a starter offered under a running
   * conversation reads as a second, competing action.
   */
  conversationStarted: boolean;
  /** Seed the composer with a prompt entry's text. */
  onPrompt: (prompt: string) => void;
  /** The Twilio journey was picked — the vendor setup prompt joins the bar. */
  onTwilioJourney: (selected: boolean) => void;
  /** Land an object pack on the board. */
  onPack: (template: CreationTemplate) => void;
}

/**
 * THE COMPOSER'S STARTING POINTS, inside the composer card.
 *
 * It used to be `PromptUseCasePicker`'s floating tab — a half-bordered "Choose a starting
 * point ^" right-aligned ABOVE the composer, belonging to nothing, with its catalogue
 * opening further up as an overlay. Now the trigger is a button in the card's top row,
 * beside the intent segment, and the catalogue opens INSIDE the card above that row,
 * sharing its border.
 *
 * The wrapper is `display: contents`, so the catalogue and the trigger are grid items of
 * the composer card itself (`.composerCard` places them by area) while this component
 * still owns both, and the wrapper's DOM node still contains both for the outside-press
 * test. Drawn only inside the composer, which is never drawn while presenting — so it
 * needs no gate of its own.
 *
 * ── LED BY THE PHASE ─────────────────────────────────────────────────────────────
 * The list opens on the canvas's phase: its three starters first (`PHASE_STARTERS`),
 * then the catalogue with the use cases that serve this phase moved ahead of the rest
 * (`categoryServesPhase`). Everything else follows unchanged. The trigger names the
 * phase, so "Starting points · Measure" says why the list is in that order.
 */
export const CanvasPromptStarter = memo(function CanvasPromptStarter({
  open, onOpenChange, conversationStarted, onPrompt, onTwilioJourney, onPack,
}: CanvasPromptStarterProps) {
  const t = useTranslations('creationCanvas');
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const catalogId = useId();
  useDismissOnOutsidePress(rootRef, open, () => onOpenChange(false));
  const tn = useTranslations('nav');
  const phase = useCanvasPhase()?.phase;
  const phaseName = phase ? tn(`stage.${phase}` as 'stage.idea') : null;
  const lead = useMemo(() => (phase && phaseName ? {
    heading: t('startingPointsFor', { phase: phaseName }),
    items: PHASE_STARTERS[phase].map((starter) => {
      const keys = phaseStarterKeys(phase, starter.key);
      return {
        id: `${phase}:${starter.key}`,
        label: t(keys.labelKey as 'phaseStarters.idea.capture.label'),
        // A starter SEEDS the composer, the same as every catalogue prompt: the person
        // reads it, edits it, and sends it themselves.
        onSelect: () => { onOpenChange(false); onPrompt(t(keys.promptKey as 'phaseStarters.idea.capture.prompt')); },
      };
    }),
  } : undefined), [onOpenChange, onPrompt, phase, phaseName, t]);
  const preferCategory = useCallback((category: string) => (phase ? categoryServesPhase(category, phase) : false), [phase]);

  return <div ref={rootRef} className={styles.promptStarter} data-tour="creation-prompt-starter" data-open={open ? 'true' : 'false'}>
    {/* One menu, every source. A prompt seeds the composer, a pack lands on the
        board, and an installable template opens its guided setup — dispatched by
        `applyTemplateEntry` so this surface never branches on where an entry
        came from. */}
    <PromptUseCaseCatalog
      open={open}
      id={catalogId}
      variant="inline"
      className={styles.promptStarterCatalog}
      {...(lead ? { lead, preferCategory } : {})}
      onSelect={(entry) => {
        onOpenChange(false);
        applyTemplateEntry(entry, {
          onPrompt: (nextPrompt) => {
            onPrompt(nextPrompt);
            if (entry.id === 'twilio-ai-journey') onTwilioJourney(true);
          },
          onPack: (template) => onPack(template),
          onInstall: (key) => router.push(`/templates?open=${encodeURIComponent(key)}`),
        });
      }}
    />
    {(!conversationStarted || open) && <button
      type="button"
      className={styles.promptStarterTrigger}
      data-testid="canvas-prompt-starter-trigger"
      aria-expanded={open}
      aria-controls={catalogId}
      onClick={() => onOpenChange(!open)}
    >
      <Icon name="template" size={14} />
      {phaseName ? t('startingPointsFor', { phase: phaseName }) : t('startingPoints')}
    </button>}
  </div>;
});
