/*
 * No `'use client'` — imported only from `BrainDock`, `CreationNode` and `CanvasChatSurface`, all inside the canvas's own
 * client boundary. See the `use-client-is-a-declaration` rule.
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';
import { BrainSurfaceMenu } from './BrainSurfaceMenu';
import { CopyCanvasDiagnosticsButton } from './canvasDiagnosticsContext';
import { useBrainSurfaceView } from './brainSurfaceView';
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
 * The header's controls, in ONE row: Context, Copy diagnostics, the "More" menu that
 * holds every display and placement setting by name (`BrainSurfaceMenu`), and Close.
 *
 * The Context toggle used to sit in a second row under the header with a "CHAT" caption;
 * it shares the body's view through `brainSurfaceView`, so it can live up here and that
 * row is gone.
 */
export function BrainSurfaceActions({ onClose, ...menu }: BrainSurfaceActionsProps) {
  const t = useTranslations('creationCanvas');
  const { view, setView } = useBrainSurfaceView();

  return (
    <div className={styles.brainDockActions}>
      <button
        type="button"
        aria-pressed={view === 'context'}
        aria-label={t('context')}
        title={t('context')}
        onClick={() => setView(view === 'context' ? 'chat' : 'context')}
      ><Icon name="info" size={15} /></button>
      {/* The canvas's diagnostics report — in every placement of this header, on every
          surface, including the ones that hide the board. */}
      <CopyCanvasDiagnosticsButton />
      <BrainSurfaceMenu {...menu} />
      {onClose && <button type="button" aria-label={t('closeBrain')} title={t('closeBrain')} onClick={onClose}><Icon name="close" size={15} /></button>}
    </div>
  );
}
