import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatterFor } from '@/i18n/format';
import type { Locale } from '@/i18n/config';
import type { RoomStationInstance } from '@/lib/canvas/roomStations';
import { CanvasWidgetFrame } from '@/components/canvas-widgets/CanvasWidgetFrame';
import { CanvasWidgetHost } from '@/components/canvas-widgets/CanvasWidgetHost';
import { useWidgetPlacement } from '@/components/canvas-widgets/useWidgetPlacement';
import type { RoomStationModel, RoomStationView } from './types';
import styles from './roomStations.module.css';

/**
 * A THIRD-PARTY WIDGET ON A STAND — the same placement the flat board frames on its
 * card, standing in the room with the live frame ON its face (`SurfacePanel`'s
 * content), and at full size in the panel.
 *
 * One frame at a time: while the panel has the widget, the face shows where it went
 * rather than running a second copy that would answer the same messages twice.
 * Entitlement is the placement's own (`useWidgetPlacement`): no server board, an
 * unregistered or disabled widget — null, and nothing stands.
 */

function useWidgetStandModel(instance: RoomStationInstance, panelOpen: boolean): RoomStationModel | null {
  const t = useTranslations('roomStations.widget');
  const placement = useWidgetPlacement(instance.objectId ?? '', instance.resourceId);
  if (!placement) return null;
  const name = placement.status === 'ready' ? placement.widget.name : '';
  let face;
  if (placement.status === 'loading') face = <p className={styles.faceNote}>{t('loading')}</p>;
  else if (panelOpen) face = <p className={styles.faceNote}>{t('inPanel')}</p>;
  else face = (
    <CanvasWidgetFrame
      widget={placement.widget}
      bridge={placement.bridge}
      boardVersion={placement.boardVersion}
      labels={placement.labels}
      sizing="fill"
    />
  );
  return { title: instance.title || name || t('untitled'), summary: t('summary'), face };
}

const PERMISSION_KEYS: Record<string, string> = {
  'board:read': 'boardRead',
  'item:read': 'itemRead',
  'item:write': 'itemWrite',
  'user:read': 'userRead',
  'storage:read': 'storageRead',
  'storage:write': 'storageWrite',
  notify: 'notify',
};

function WidgetStandPanel({ instance }: { instance: RoomStationInstance }) {
  const t = useTranslations('roomStations.widget');
  const locale = useLocale() as Locale;
  const fmt = useMemo(() => formatterFor(locale), [locale]);
  const placement = useWidgetPlacement(instance.objectId ?? '', instance.resourceId);
  if (!placement) return null;
  const widget = placement.status === 'ready' ? placement.widget : null;
  const granted = widget?.permissions.flatMap((permission) => (PERMISSION_KEYS[permission] ? [t(`permission.${PERMISSION_KEYS[permission]}`)] : [])) ?? [];
  return (
    <div className={styles.panel} data-testid="widget-stand-panel">
      {widget?.description && <p className={styles.intro}>{widget.description}</p>}
      {widget && (
        <p className={styles.note}>{granted.length ? t('permissions', { permissions: fmt.list(granted) }) : t('noPermissions')}</p>
      )}
      <div className={styles.widgetBox}>
        <CanvasWidgetHost objectId={instance.objectId ?? ''} widgetId={instance.resourceId} sizing="fill" />
      </div>
    </div>
  );
}

export const widgetStandView: RoomStationView = {
  useModel: (instance, panelOpen) => useWidgetStandModel(instance, panelOpen),
  Panel: WidgetStandPanel,
};
