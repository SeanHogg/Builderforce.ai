import { useTranslations } from 'next-intl';
import { resourceIdOfType } from '@builderforce/creation-canvas-contract';
import { CANVAS_WIDGET_RESOURCE_TYPE } from '@builderforce/canvas-widget-protocol';
import { CanvasWidgetFrame } from './CanvasWidgetFrame';
import { useWidgetPlacement } from './useWidgetPlacement';
import styles from './CanvasWidgetFrame.module.css';

/**
 * A `canvas_widget` placement, mounted — self-contained: it resolves its own widget
 * and its own entitlement, and renders nothing when it may not mount (see
 * `useWidgetPlacement`). Used on the flat card and in the room's 2D panel; the room's
 * stand draws the same frame on its face from the same hook.
 *
 * `nodrag nowheel` because on the flat board it sits inside a node: a pointer or a
 * scroll inside somebody's widget must reach the widget, not move or zoom the board.
 */
export function CanvasWidgetHost({ objectId, widgetId, sizing = 'intrinsic' }: {
  objectId: string;
  widgetId: string | undefined;
  sizing?: 'fill' | 'intrinsic';
}) {
  const t = useTranslations('roomStations.widget');
  const placement = useWidgetPlacement(objectId, widgetId);
  if (!placement) return null;
  if (placement.status === 'loading') return <p className={styles.status} role="status">{t('loading')}</p>;
  return (
    <div className="nodrag nowheel" data-testid="canvas-widget-host" style={sizing === 'fill' ? { height: '100%' } : undefined}>
      <CanvasWidgetFrame
        widget={placement.widget}
        bridge={placement.bridge}
        boardVersion={placement.boardVersion}
        labels={placement.labels}
        sizing={sizing}
      />
    </div>
  );
}

/**
 * The flat card's widget, for ANY object kind: a placement is a board object whose
 * `resourceId` is `canvas_widget:<registry id>` (the protocol's rule — not a new kind),
 * so the card asks every object and this answers null for all but placements.
 */
export function CanvasWidgetNodeBody({ objectId, resourceId }: { objectId: string; resourceId: unknown }) {
  const widgetId = resourceIdOfType(resourceId, CANVAS_WIDGET_RESOURCE_TYPE);
  return widgetId ? <CanvasWidgetHost objectId={objectId} widgetId={widgetId} /> : null;
}
