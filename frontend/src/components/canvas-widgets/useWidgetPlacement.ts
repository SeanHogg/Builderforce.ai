import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { resolveCanvasWidget, type CanvasWidgetRecord } from '@/lib/canvasWidgetApi';
import type { WidgetHostBridge } from '@/lib/canvasWidgetHost';
import { useCanvasBoardBridge } from '@/components/creation-canvas/canvasBoardBridge';
import type { CanvasWidgetFrameLabels } from './CanvasWidgetFrame';
import { widgetBoardBridge } from './widgetBoardBridge';

export type WidgetPlacement =
  | { status: 'loading' }
  | {
    status: 'ready';
    widget: CanvasWidgetRecord;
    bridge: WidgetHostBridge;
    labels: CanvasWidgetFrameLabels;
    boardVersion: unknown;
  };

/**
 * Everything a widget frame needs for ONE placement, resolved from context — so the
 * frame itself can be context-free and drawn on a room stand's face.
 *
 * Returns null when the placement cannot mount for THIS viewer: no board, a device-
 * only draft (nothing on a server to resolve the widget against), or a widget that is
 * not registered in the board's workspace or has been disabled. Null is the whole
 * entitlement answer — every surface that shows a placement renders nothing then.
 */
export function useWidgetPlacement(objectId: string, widgetId: string | undefined): WidgetPlacement | null {
  const board = useCanvasBoardBridge();
  const t = useTranslations('roomStations.widget');
  const sessionId = board && board.persistence === 'server' ? board.sessionId : null;
  const [resolved, setResolved] = useState<{ key: string; widget: CanvasWidgetRecord | null } | null>(null);
  const key = sessionId && widgetId ? `${sessionId}:${widgetId}` : null;

  useEffect(() => {
    if (!sessionId || !widgetId || !key) return undefined;
    let live = true;
    void resolveCanvasWidget(sessionId, widgetId).then((widget) => {
      if (live) setResolved({ key, widget });
    });
    return () => { live = false; };
  }, [key, sessionId, widgetId]);

  const widget = resolved && resolved.key === key ? resolved.widget : undefined;
  const bridge = useMemo(
    () => (board && widget ? widgetBoardBridge(board, objectId, widget) : null),
    [board, objectId, widget],
  );
  const labels = useMemo<CanvasWidgetFrameLabels | null>(() => (widget ? {
    frameTitle: t('frameTitle', { name: widget.name }),
    navigated: t('navigated'),
    reload: t('reload'),
    closed: t('closed'),
    reopen: t('reopen'),
  } : null), [t, widget]);

  if (!board || !key) return null;
  if (widget === undefined) return { status: 'loading' };
  if (!widget || !bridge || !labels) return null;
  return { status: 'ready', widget, bridge, labels, boardVersion: board.objects };
}
