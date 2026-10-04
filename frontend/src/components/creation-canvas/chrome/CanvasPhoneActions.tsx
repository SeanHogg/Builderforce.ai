import { memo, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { AddObjectIcon } from '@/components/canvas/CanvasCommands';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import { CanvasActionsSheet } from '../CanvasActionsSheet';
import type { CanvasBarGroupSlots, CanvasSessionActionHandler } from '../CanvasSessionActions';
import type { useCanvasNodePanels } from '../hooks/useCanvasNodePanels';

type NodePanels = ReturnType<typeof useCanvasNodePanels>;

export interface CanvasPhoneActionsProps {
  open: boolean;
  surface: CanvasSurfaceId;
  handlers: Record<CanvasSessionActionId, CanvasSessionActionHandler>;
  onClose: () => void;
  setObjectPicker: NodePanels['setObjectPicker'];
  setNodePanel: NodePanels['setNodePanel'];
}

/**
 * THE PHONE'S COMMAND BAR: one sheet, opened from the composer's "+", holding
 * every registry action under the same arc captions the desktop bar uses.
 * Mounted only while open.
 */
export const CanvasPhoneActions = memo(function CanvasPhoneActions({ open, surface, handlers, onClose, setObjectPicker, setNodePanel }: CanvasPhoneActionsProps) {
  const t = useTranslations('creationCanvas');
  // The one door the registry does not own: the palette opens against the
  // pressed button's own screen rect, so the chrome that draws the button
  // contributes it — through the same `CanvasBarGroupSlots` seam the bar uses.
  const slots = useMemo<CanvasBarGroupSlots>(() => ({
    idea: {
      lead: surface === 'graph' ? <button
        type="button"
        data-testid="canvas-actions-quick-add"
        aria-label={t('quickAdd')}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onClose();
          setNodePanel(null);
          setObjectPicker({ anchor: { x: Math.max(12, Math.min(rect.left, window.innerWidth - 412)), y: Math.max(12, rect.top - 330) } });
        }}
      ><span aria-hidden><AddObjectIcon /></span>{t('quickAdd')}</button> : undefined,
    },
  }), [onClose, setNodePanel, setObjectPicker, surface, t]);
  if (!open) return null;
  return <CanvasActionsSheet
    surface={surface}
    handlers={handlers}
    slots={slots}
    onClose={onClose}
  />;
});
