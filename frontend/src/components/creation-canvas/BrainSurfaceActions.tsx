/*
 * No `'use client'` — imported only from `BrainDock`, `CreationNode` and `CanvasChatSurface`, all inside the canvas's own
 * client boundary. See the `use-client-is-a-declaration` rule.
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';
import { CopyCanvasDiagnosticsButton } from './canvasDiagnosticsContext';
import { useCanvasSurfaceDefinition } from './canvasSurfaceContext';
import type { BrainDockMode, BrainDockSide, BrainDockSize } from './brainDockPreferences';

/*
 * The Brain surface's header controls, in a module of their own: three placements draw
 * them — the edge dock, the Brain Object on the graph and the chat surface — and none
 * of the other two should have to import the dock to get its header.
 */

export interface BrainSurfaceActionsProps {
  mode: BrainDockMode;
  showExecutionDetail: boolean;
  /** Move the conversation between the edge and the Brain Object. Not offered — and
   *  therefore never called — while a surface other than the board is drawn. */
  onModeChange: (mode: BrainDockMode) => void;
  onExecutionDetailChange: (show: boolean) => void;
  /** Put the conversation away. Omitted by a placement that IS the conversation, where
   *  there is nothing left on screen once it goes — the way out of that one is the
   *  surface switcher, not a dismiss. */
  onClose?: () => void;
  /** Edge-only placement controls; an inline surface is sized by its Object. */
  side?: BrainDockSide;
  size?: BrainDockSize;
  onSideChange?: (side: BrainDockSide) => void;
  onSizeChange?: (size: BrainDockSize) => void;
  /**
   * Put the prompt back on the board. Passed ONLY by the placement that currently holds
   * it, so the control lives beside the thing it releases and exists in exactly one
   * place: the way IN is the prompt's own header while it floats, the way OUT is here
   * once it no longer has a header of its own to carry it.
   */
  onUndockPrompt?: () => void;
}

/**
 * The surface's controls. It decides for itself which of them apply: which edge and
 * how wide are meaningless for a surface that lives in an Object on the graph, where
 * the Object's own resize handles already do that job — and both placement and dismiss
 * are meaningless for a surface that IS the whole canvas.
 */
export function BrainSurfaceActions({
  mode, showExecutionDetail, onModeChange, onExecutionDetailChange, onClose,
  side, size, onSideChange, onSizeChange, onUndockPrompt,
}: BrainSurfaceActionsProps) {
  const t = useTranslations('creationCanvas');
  const inline = mode === 'inline';
  const expanded = size === 'expanded';
  const docked = !inline && !!side && !!onSideChange && !!onSizeChange;
  // Read, not passed in: the canvas publishes which surface it is drawing, so this
  // control can tell for itself that the board it would move INTO is not on screen.
  // Offering "show this in the Brain Object" while a 3D scene — or the conversation
  // surface itself — has taken the centre is a control that hides the chat and gives
  // back nothing, so it is simply not offered until the board is there again.
  const boardAvailable = useCanvasSurfaceDefinition().showsBoard;

  return (
    <div className={styles.brainDockActions}>
      {/* The canvas's diagnostics report — in every placement of this header, on every
          surface, including the ones that hide the board. */}
      <CopyCanvasDiagnosticsButton />
      <button
        type="button"
        aria-pressed={showExecutionDetail}
        aria-label={showExecutionDetail ? t('hideExecutionSteps') : t('showExecutionSteps')}
        title={showExecutionDetail ? t('hideExecutionSteps') : t('showExecutionSteps')}
        onClick={() => onExecutionDetailChange(!showExecutionDetail)}
      >⋮⋮</button>
      {/* The prompt is in this panel's column, so the panel carries the way out of it.
          Pressed, the prompt floats over the board again — the placement it came from. */}
      {onUndockPrompt && <button
        type="button"
        aria-pressed
        aria-label={t('floatPrompt')}
        title={t('floatPrompt')}
        onClick={onUndockPrompt}
      ><Icon name="external-link" size={14} /></button>}
      {boardAvailable && <button
        type="button"
        aria-pressed={inline}
        aria-label={inline ? t('dockBrainToEdge') : t('showBrainInObject')}
        title={inline ? t('dockBrainToEdge') : t('showBrainInObject')}
        onClick={() => onModeChange(inline ? 'docked' : 'inline')}
      >{inline ? '▤' : '▣'}</button>}
      {/* data-dock-side, not the label, is what the stylesheet hides on a phone:
          a selector keyed on English copy would stop matching in every other locale. */}
      {docked && <button
        type="button"
        data-dock-side="left"
        aria-pressed={side === 'left'}
        aria-label={t('dockBrainLeft')}
        title={t('dockBrainLeft')}
        onClick={() => onSideChange!('left')}
      >⇤</button>}
      {docked && <button
        type="button"
        data-dock-side="right"
        aria-pressed={side === 'right'}
        aria-label={t('dockBrainRight')}
        title={t('dockBrainRight')}
        onClick={() => onSideChange!('right')}
      >⇥</button>}
      {docked && <button
        type="button"
        aria-pressed={expanded}
        aria-label={expanded ? t('slimBrain') : t('expandBrain')}
        title={expanded ? t('slimBrain') : t('expandBrain')}
        onClick={() => onSizeChange!(expanded ? 'slim' : 'expanded')}
      >{expanded ? '⤡' : '⤢'}</button>}
      {onClose && <button type="button" aria-label={t('closeBrain')} title={t('closeBrain')} onClick={onClose}>×</button>}
    </div>
  );
}
