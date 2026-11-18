/**
 * Live preview of a running app — THE one preview surface for both run targets
 * (PRD 31 §W1 item 7, §W9): device frame, Expo QR, service tabs, restart, logs,
 * which target ran it and why, Run (for the browser target), and the 402 gate.
 *
 * Mounted from the execution-panel Preview tab (360px drawer) and the project
 * app panel. It reads a `RunSession` (`useLivePreview`), never a target's own API:
 * the browser runtime and the container look the same here. The iframe is
 * {@link CanvasDeviceFrame} so desktop/tablet/phone actually change the document
 * width. `exp://` URLs cannot load in an iframe, so those render a QR instead.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CanvasViewport } from '@builderforce/creation-canvas-contract';
import { CanvasDeviceFrame } from '@/components/creation-canvas/CanvasDeviceFrame';
import { CanvasViewportSwitcher } from '@/components/creation-canvas/CanvasViewportSwitcher';
import { QrCode } from '@/components/builder/QrCode';
import { UpgradeGate } from '@/components/insights/UpgradeGate';
import { isExpoPreviewUrl, useLivePreview } from './useLivePreview';
import { RunTargetNote } from './RunTargetNote';
import { RunLogsView } from './RunLogsView';
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
  const [showLogs, setShowLogs] = useState(false);

  const tabs = useMemo(() => preview.services.filter((s) => s.previewable), [preview.services]);
  const active = tabs.find((s) => s.id === serviceId) ?? tabs[0];
  const expo = active?.url ? isExpoPreviewUrl(active.url) : false;
  // The browser runtime streams each service's output; a container preview has no log channel yet.
  const hasLogs = preview.session?.targetId === 'browser';
  const allStopped = preview.services.length > 0 && preview.services.every((s) => s.state === 'stopped');

  if (!enabled) return null;

  const gate = preview.planError ? (
    <UpgradeGate error={preview.planError} fallback={<p className={styles.empty}>{t('unavailable')}</p>} />
  ) : null;

  const runCta = (
    <div className={styles.runCta}>
      <button type="button" className={styles.runButton} onClick={preview.start} disabled={preview.loading}>
        {t('runInBrowser')}
      </button>
      <p className={styles.hint}>{t('runInBrowserHint')}</p>
    </div>
  );

  if (preview.run?.awaiting === 'browser' && !active) {
    return (
      <div className={styles.root}>
        {runCta}
        <RunTargetNote run={preview.run} />
        {gate}
      </div>
    );
  }

  if (gate) {
    return (
      <div className={styles.root}>
        {gate}
        <RunTargetNote run={preview.run} />
      </div>
    );
  }

  if (preview.loading && !active) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>{t('loading')}</p>
      </div>
    );
  }

  if (!active) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>{t('unavailable')}</p>
        <p className={styles.hint}>{t('unavailableHint')}</p>
        <RunTargetNote run={preview.run} />
      </div>
    );
  }

  if (allStopped) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>{t('stopped')}</p>
        {hasLogs && runCta}
        <RunTargetNote run={preview.run} />
      </div>
    );
  }

  const failed = preview.services.filter((s) => s.state === 'failed');

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {tabs.length > 1 && (
          <div className={styles.services} role="tablist" aria-label={t('title')}>
            {tabs.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === active.id}
                className={s.id === active.id ? styles.tabActive : styles.tab}
                onClick={() => setServiceId(s.id)}
              >
                {s.label ?? t('serviceApp')}
              </button>
            ))}
          </div>
        )}
        {!expo && <CanvasViewportSwitcher value={viewport} onChange={setViewport} />}
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={preview.reload}>{t('reload')}</button>
          <button type="button" className={styles.action} onClick={() => preview.restart(active.id)}>{t('restart')}</button>
          {hasLogs && (
            <button type="button" className={styles.action} aria-pressed={showLogs} onClick={() => setShowLogs((v) => !v)}>
              {showLogs ? t('hideLogs') : t('logs')}
            </button>
          )}
          {active.url && <a className={styles.action} href={active.url} target="_blank" rel="noreferrer">{t('open')}</a>}
        </div>
        {active.state === 'starting' && <span className={styles.status}>{t('starting')}</span>}
      </div>
      <RunTargetNote run={preview.run} />
      {failed.map((s) => (
        <p key={s.id} className={styles.failure} role="alert">
          {t('serviceFailed', { service: s.label ?? t('serviceApp') })}
          {s.error && <span className={styles.declineDetail}>{s.error}</span>}
        </p>
      ))}
      {showLogs && hasLogs && <RunLogsView key={active.id} session={preview.session} serviceId={active.id} />}
      {expo && active.url ? (
        <div className={styles.expo}>
          <QrCode value={active.url} size={180} label={t('expoQrLabel')} />
          <p className={styles.hint}>{t('expoQr')}</p>
        </div>
      ) : active.url ? (
        <CanvasDeviceFrame
          title={t('title')}
          viewport={viewport}
          src={active.url}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          reloadKey={`${preview.reloadKey}:${active.id}`}
          className={styles.frame}
        >
          {active.state === 'starting' ? t('starting') : undefined}
        </CanvasDeviceFrame>
      ) : (
        <p className={styles.empty}>{t(`serviceState.${active.state}`)}</p>
      )}
    </div>
  );
}
