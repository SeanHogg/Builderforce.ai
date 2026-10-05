// No 'use client' directive: rendered only inside `CreationCanvas`, which declares it.
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useStore, ViewportPortal } from '@xyflow/react';
import { ghostPosition, phaseFirstKind, phaseFocusOf, type LensNode } from '@/lib/canvasPhaseLens';
import type { CanvasPhase } from '@/lib/canvasPhases';
import { usePhoneViewport } from '@/lib/usePhoneViewport';
import type { CreationObjectKind } from '../types';
import { useCanvasSurfaceDefinition } from '../canvasSurfaceContext';
import { useCanvasPhase, useLetBrain } from './CanvasPhaseContext';
import styles from '../CreationCanvas.module.css';

/**
 * THE GHOST CARD — where the phase's first object would go, drawn before it exists.
 *
 * A phase with nothing of its own on the board used to look exactly like a phase that
 * had not been chosen. The ghost stands just right of everything on the board (under it
 * when that slot is off screen; at the centre of an empty board) and offers the two ways
 * to fill it: have Brain do it, or add the phase's first kind by hand. In an UNREADY phase it names what is missing instead.
 *
 * ── WHY IT IS NOT A NODE ─────────────────────────────────────────────────────────
 * A fake node would reach autosave, presence, undo and the mini map. This is drawn in
 * flow coordinates through `ViewportPortal`, so it pans and zooms with the board, and it
 * never enters `nodes`: nothing here can write the board except the real add path.
 *
 * It decides its own visibility: nothing when the lens is off, on a phone (the path card
 * covers it there), when the board is not what is on screen, or once any card the phase
 * brings forward exists.
 */
type FlowState = {
  nodeLookup?: Map<string, { position?: { x: number; y: number }; measured?: { width?: number; height?: number }; data?: { kind?: unknown } }>;
  width?: number;
  height?: number;
  transform?: [number, number, number];
};

/** "in-phase card exists" and the ghost's flow position, as one string so the store
 *  re-renders this only when one of them changes — not on every pointer move. */
function placementKey(state: FlowState, phase: CanvasPhase): string {
  const nodes: LensNode[] = [];
  let hasIn = false;
  for (const node of state.nodeLookup?.values() ?? []) {
    if (phaseFocusOf(String(node.data?.kind ?? ''), phase) === 'in') hasIn = true;
    nodes.push({ position: node.position ?? { x: 0, y: 0 }, ...(node.measured ? { measured: node.measured } : {}) });
  }
  if (hasIn) return 'in';
  const [tx, ty, rawZoom] = state.transform ?? [0, 0, 1];
  const zoom = rawZoom || 1;
  const viewport = { x: -tx / zoom, y: -ty / zoom, width: (state.width ?? 0) / zoom, height: (state.height ?? 0) / zoom };
  const { x, y } = ghostPosition(nodes, viewport);
  return `${Math.round(x)}|${Math.round(y)}`;
}

export function PhaseGhostCard() {
  const t = useTranslations('creationCanvas');
  const tn = useTranslations('nav');
  const phaseValue = useCanvasPhase();
  const letBrain = useLetBrain();
  const surfaceDef = useCanvasSurfaceDefinition();
  const phone = usePhoneViewport();
  const phase = phaseValue?.phase ?? 'idea';
  const key = useStore(useCallback((state: FlowState) => placementKey(state, phase), [phase]));
  if (!phaseValue || !letBrain || !phaseValue.focusEnabled || phone || !surfaceDef.showsBoard || key === 'in') return null;
  const [x, y] = key.split('|').map(Number) as [number, number];
  const { current, appendAtCenter } = phaseValue;
  const stage = (id: string) => tn(`stage.${id}` as 'stage.idea');
  const missing = current.missing[0];
  const kind = phaseFirstKind(phase);

  return (
    <ViewportPortal>
      <aside
        className={styles.phaseGhost}
        data-testid="canvas-phase-ghost"
        data-ready={current.ready ? 'true' : 'false'}
        aria-label={t('phaseGhost.label', { phase: stage(phase) })}
        style={{ transform: `translate(${x}px, ${y}px)` }}
      >
        {missing ? <>
          <span className={styles.phaseGhostKicker}>{t('phaseGhost.needs', { phase: stage(missing.satisfiedIn) })}</span>
          <strong className={styles.phaseGhostTitle}>{t(`phaseGate.${phase}.title` as 'phaseGate.make.title')}</strong>
          <div className={styles.phaseGhostActions}>
            <button type="button" className={styles.phasePathButton} data-primary="true" onClick={() => letBrain.askRequirement(missing.id)}>
              {t('phasePath.letBrain', { verb: letBrain.requirementVerb(missing.id) })}
            </button>
          </div>
        </> : <>
          <span className={styles.phaseGhostKicker}>{t('phaseGhost.empty')}</span>
          <strong className={styles.phaseGhostTitle}>{t('phaseGhost.title', { phase: stage(phase) })}</strong>
          <div className={styles.phaseGhostActions}>
            <button type="button" className={styles.phasePathButton} data-primary="true" onClick={letBrain.askPhase}>
              {t('phasePath.letBrain', { verb: letBrain.phaseVerb })}
            </button>
            {appendAtCenter && <button type="button" className={styles.phasePathButton} onClick={() => appendAtCenter(kind as CreationObjectKind)}>
              {t('phaseGhost.add', { kind: t(`object.${kind}` as 'object.idea') })}
            </button>}
          </div>
        </>}
      </aside>
    </ViewportPortal>
  );
}
