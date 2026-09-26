'use client';

/**
 * Live preview of a running app — device frame, Expo QR, service tabs, 402 gate.
 *
 * Mounted from the execution-panel Preview tab (360px drawer) and the project
 * app panel. The iframe is {@link CanvasDeviceFrame} so desktop/tablet/phone
 * actually change the document width. `exp://` URLs cannot load in an iframe,
 * so those render a QR instead.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasViewport } from '@builderforce/creation-canvas-contract';
import { CanvasDeviceFrame } from '@/components/creation-canvas/CanvasDeviceFrame';
import { CanvasViewportSwitcher } from '@/components/creation-canvas/CanvasViewportSwitcher';
import { QrCode } from '@/components/builder/QrCode';
import { UpgradeGate } from '@/components/insights/UpgradeGate';
import { isExpoPreviewUrl, useLivePreview } from './useLivePreview';
import styles from './LivePreviewPanel.module.css';

export function LivePreviewPanel({
  projectId,
  executionId,
  enabled = true,
}: {
  projectId?: number | string;
  executionId?: number | null;
  enabled?: boolean;
}) {
  const t = useTranslations('livePreview');
  const preview = useLivePreview({ projectId, executionId, enabled });
  const [viewport, setViewport] = useState<CanvasViewport>('desktop');
  const [serviceId, setServiceId] = useState<string | null>(null);

  const services = useMemo(() => {
    if (!preview.link) return [];
    if (preview.link.services && preview.link.services.length > 0) return preview.link.services;
    return [{ id: 'app', label: t('serviceApp'), url: preview.link.url }];
  }, [preview.link, t]);

  const active = services.find((s) => s.id === serviceId) ?? services[0];
  const expo = active ? isExpoPreviewUrl(active.url) : false;

  if (!enabled) return null;

  if (preview.planError) {
    return (
      <div className={styles.root}>
        <UpgradeGate
          error={preview.planError}
          fallback={<p className={styles.empty}>{t('unavailable')}</p>}
        />
      </div>
    );
  }

  if (preview.loading && !preview.link) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>{t('loading')}</p>
      </div>
    );
  }

  if (!preview.link || !active) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>{t('unavailable')}</p>
        <p className={styles.hint}>{t('unavailableHint')}</p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {services.length > 1 && (
          <div className={styles.services} role="tablist" aria-label={t('title')}>
            {services.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === active.id}
                className={s.id === active.id ? styles.tabActive : styles.tab}
                onClick={() => setServiceId(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        {!expo && <CanvasViewportSwitcher value={viewport} onChange={setViewport} />}
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={preview.reload}>{t('reload')}</button>
          <button type="button" className={styles.action} onClick={preview.restart}>{t('restart')}</button>
          <a className={styles.action} href={active.url} target="_blank" rel="noreferrer">{t('open')}</a>
        </div>
        {preview.link.status === 'starting' && (
          <span className={styles.status}>{t('starting')}</span>
        )}
      </div>
      {expo ? (
        <div className={styles.expo}>
          <QrCode value={active.url} size={180} label={t('expoQrLabel')} />
          <p className={styles.hint}>{t('expoQr')}</p>
        </div>
      ) : (
        <CanvasDeviceFrame
          title={t('title')}
          viewport={viewport}
          src={active.url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          reloadKey={`${preview.reloadKey}:${active.id}`}
          className={styles.frame}
        >
          {preview.link.status === 'starting' ? t('starting') : undefined}
        </CanvasDeviceFrame>
      )}
    </div>
  );
}
