// No 'use client' directive, for the reason `CanvasSurfaceSwitcher` and every other
// leaf under `CreationCanvas` state: the client boundary is already declared above it.
import { useTranslations } from 'next-intl';
import { CANVAS_PHASES, surfacesForPhase, type CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasSurfaceSwitcher } from './CanvasSurfaceSwitcher';
import styles from './CreationCanvas.module.css';

/**
 * ONE fused widget: which PHASE of the session's own methodology this is, over which
 * SURFACE reads it — a phase stepper and the (phase-narrowed) modality tabs, in one
 * card rather than two.
 *
 * ── WHY ONE COMPONENT AND NOT TWO CARDS ──────────────────────────────────────────
 * They used to be exactly that: a phase row and `CanvasSurfaceSwitcher` floating as
 * two separate cards stacked in the same corner. Two borders, two shadows and a 4px
 * gap between them read as two unrelated controls that happened to be near each
 * other, when the second is answering a question the first just asked — "given that
 * phase, how do you want to read this session?" A hairline INSIDE one card says that;
 * a gap between two cards says the opposite.
 *
 * ── WHY THE PHASE ROW DRIVES THE SURFACE ROW ─────────────────────────────────────
 * `surfacesForPhase()` (`lib/canvasPhases.ts`) is what narrows the tabs — every phase
 * offers Chat, Board, 3D space and App (they predate this registry; a phase never
 * takes one away), and Measure adds Insights, which is the one surface actually worth
 * gating: nothing to show before a session has something worth measuring. The
 * narrowing is additive, so pressing a later phase never takes a surface away, only
 * widens the offer; see that file for why. If the surface the visitor was already on
 * falls outside the new phase's set (only possible for Insights, moving backward),
 * the host is what resets it (this component only reports the phase change, it does
 * not own `surface`) — same separation as `CanvasSurfaceSwitcher` itself, which
 * reports a press and never decides what happens next.
 */
export interface PhaseModalitySelectorProps {
  phase: CanvasPhase;
  onPhaseChange: (phase: CanvasPhase) => void;
  surface: CanvasSurfaceId;
  onSurfaceChange: (surface: CanvasSurfaceId) => void;
}

export function PhaseModalitySelector({ phase, onPhaseChange, surface, onSurfaceChange }: PhaseModalitySelectorProps) {
  const t = useTranslations('nav');
  const allowed = surfacesForPhase(phase);

  return (
    <div className={styles.phaseModalityGroup}>
      <div className={styles.phaseStepper} role="tablist" aria-label={t('journey.label')}>
        {CANVAS_PHASES.map((step) => {
          const active = step === phase;
          return (
            <button
              key={step}
              type="button"
              role="tab"
              aria-selected={active}
              data-stage={step}
              className={styles.phaseStep}
              // Pressing the phase you are already on is a no-op rather than a reset —
              // unlike a surface, there is no "board" a phase returns you to.
              onClick={() => onPhaseChange(step)}
            >
              <span className={styles.phaseStepDot} aria-hidden />
              <span>{t(`stage.${step}`)}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.phaseModalityDivider} aria-hidden />
      <CanvasSurfaceSwitcher surface={surface} onChange={onSurfaceChange} variant="header" allowedIds={allowed} />
    </div>
  );
}
