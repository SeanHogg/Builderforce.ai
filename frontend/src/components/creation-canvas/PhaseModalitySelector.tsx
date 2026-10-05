// No 'use client' directive, for the reason `CanvasSurfaceSwitcher` and every other
// leaf under `CreationCanvas` state: the client boundary is already declared above it.
import { useTranslations } from 'next-intl';
import { CANVAS_PHASES, surfacesAddedByPhase, surfacesForPhase, type CanvasPhase } from '@/lib/canvasPhases';
import type { CanvasPhaseReadiness } from '@/lib/canvasPhaseReadiness';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import { CanvasSurfaceSwitcher } from './CanvasSurfaceSwitcher';
import { useCanvasPhase } from './phase/CanvasPhaseContext';
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
 * `surfacesForPhase()` (`lib/canvasPhases.ts`) is what narrows the tabs. The narrowing
 * is additive, so pressing a later phase never takes a surface away, only widens the
 * offer. If the surface already open falls outside the new phase's set, the host resets
 * it — this component only reports the phase change, it does not own `surface`.
 *
 * ── READINESS ON EACH STEP ───────────────────────────────────────────────────────
 * Each step says whether the board holds what that phase needs (`useCanvasPhase()` —
 * derived from the board, never stored): a ✓ when the phase's own output exists, a lock
 * when it is not possible yet. The lock is a SIGN, never a gate — pressing an unready
 * phase still switches to it, and the path card then says what is missing. The glyphs
 * are `aria-hidden`; the state is in each step's accessible name.
 *
 * `variant="sheet"` is the phone's reading of the same widget: each step becomes a row
 * with its status line and the surfaces it adds, because a phone sheet has the width for
 * words a floating card does not.
 */
export interface PhaseModalitySelectorProps {
  phase: CanvasPhase;
  onPhaseChange: (phase: CanvasPhase) => void;
  surface: CanvasSurfaceId;
  onSurfaceChange: (surface: CanvasSurfaceId) => void;
  variant?: 'card' | 'sheet';
}

type StepState = 'now' | 'done' | 'ready' | 'needs';

function stepState(step: CanvasPhase, phase: CanvasPhase, readiness: CanvasPhaseReadiness | undefined): StepState {
  if (step === phase) return 'now';
  if (!readiness) return 'ready';
  if (readiness.done) return 'done';
  return readiness.ready ? 'ready' : 'needs';
}

function DoneGlyph() {
  return <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.4 6.3l2.3 2.3 4.9-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function LockGlyph() {
  return <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2.5" y="5.4" width="7" height="4.8" rx="1.1" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M4.2 5.4V4a1.8 1.8 0 013.6 0v1.4" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>;
}

export function PhaseModalitySelector({ phase, onPhaseChange, surface, onSurfaceChange, variant = 'card' }: PhaseModalitySelectorProps) {
  const t = useTranslations('nav');
  const tc = useTranslations('creationCanvas');
  const phaseValue = useCanvasPhase();
  const allowed = surfacesForPhase(phase);

  const statusOf = (step: CanvasPhase) => {
    const readiness = phaseValue?.readiness.byPhase[step];
    const state = stepState(step, phase, readiness);
    const needs = readiness?.missing[0];
    const label = state === 'needs' && needs
      ? tc('phase.needs', { phase: t(`stage.${needs.satisfiedIn}` as 'stage.idea') })
      : tc(`phase.${state}` as 'phase.ready');
    return { state, readiness, label };
  };

  return (
    <div className={styles.phaseModalityGroup} data-variant={variant}>
      <div className={styles.phaseStepper} role="tablist" aria-label={t('journey.label')}>
        {CANVAS_PHASES.map((step) => {
          const active = step === phase;
          const { state, readiness, label } = statusOf(step);
          const name = t(`stage.${step}` as 'stage.idea');
          return (
            <button
              key={step}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${name}, ${label}`}
              data-stage={step}
              data-ready={readiness ? String(readiness.ready) : undefined}
              data-state={state}
              className={styles.phaseStep}
              // Pressing the phase you are already on is a no-op rather than a reset —
              // unlike a surface, there is no "board" a phase returns you to. Pressing an
              // UNREADY phase still switches: the lock is a sign, not a gate.
              onClick={() => onPhaseChange(step)}
            >
              <span className={styles.phaseStepDot} aria-hidden />
              <span className={styles.phaseStepName}>{name}</span>
              {readiness?.done && !active && <i className={styles.phaseStepGlyph} aria-hidden><DoneGlyph /></i>}
              {readiness && !readiness.ready && <i className={styles.phaseStepGlyph} aria-hidden><LockGlyph /></i>}
              {variant === 'sheet' && <small className={styles.phaseStepStatus} aria-hidden>
                {label}
                {surfacesAddedByPhase(step).length > 0 && ` · ${tc('phase.adds', {
                  surfaces: surfacesAddedByPhase(step).map((id) => tc(`surface.${id}.label` as 'surface.chat.label')).join(', '),
                })}`}
              </small>}
            </button>
          );
        })}
      </div>
      <div className={styles.phaseModalityDivider} aria-hidden />
      <CanvasSurfaceSwitcher surface={surface} onChange={onSurfaceChange} variant="header" allowedIds={allowed} />
    </div>
  );
}
