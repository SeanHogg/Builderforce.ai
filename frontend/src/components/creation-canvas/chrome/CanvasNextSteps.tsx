import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { composerNextSteps } from '@/lib/composerNextSteps';
import { canvasSurfaceDefinition, type CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { useCanvasPhase } from '../phase/CanvasPhaseContext';
import styles from '../CreationCanvas.module.css';

export interface CanvasNextStepsProps {
  /** The surface on screen — its own fixed list, or the phase's starters. */
  surface: CanvasSurfaceId;
  /** The composer's text: the chips are for an EMPTY box. */
  prompt: string;
  /** Before the first turn the starting-points trigger is the way in, not these. */
  conversationStarted: boolean;
  running: boolean;
  /** The starting-points catalogue is open in the same row. */
  catalogOpen: boolean;
  /** Seed the composer. A chip never sends: the person reads it, edits it, and sends it. */
  onPrompt: (prompt: string) => void;
}

/**
 * NEXT STEPS above an empty composer, once a conversation has started — the answer to
 * "what now?" after Brain replies, where the box used to sit blank. A FIXED list per
 * surface (`lib/composerNextSteps.ts`), so offering them costs nothing; picking one seeds
 * the box exactly the way a starting point does.
 *
 * Laid into the composer card's top band (the grid area the starting-points catalogue
 * opens in), so it stands down while that catalogue is open, while Brain is working,
 * and the moment the person starts typing.
 */
export const CanvasNextSteps = memo(function CanvasNextSteps({ surface, prompt, conversationStarted, running, catalogOpen, onPrompt }: CanvasNextStepsProps) {
  const t = useTranslations('creationCanvas');
  const phase = useCanvasPhase()?.phase;
  const steps = useMemo(() => composerNextSteps(canvasSurfaceDefinition(surface), phase), [surface, phase]);
  if (!conversationStarted || running || catalogOpen || prompt.trim() || steps.length === 0) return null;
  return (
    <div className={styles.composerNextSteps} role="group" aria-label={t('nextStepsLabel')} data-testid="canvas-next-steps">
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
          className={styles.composerNextStep}
          onClick={() => onPrompt(t(step.promptKey as 'nextStepsLabel'))}
        >
          {t(step.labelKey as 'nextStepsLabel')}
        </button>
      ))}
    </div>
  );
});
