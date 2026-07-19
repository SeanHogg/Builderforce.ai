'use client';

/**
 * DevicePreview — the Mobile modality's centre panel.
 *
 * A web iframe stretched to fill a desktop pane tells you nothing about how an
 * app feels on a phone, so Mobile projects preview inside a real device bezel at
 * the device's true viewport size, scaled down to fit the pane. Rotation and the
 * device picker change the viewport the app lays out against, which is the whole
 * point — the app re-flows exactly as it would on the device.
 *
 * The preview URL is a WebContainer dev server running in THIS browser tab, so
 * it is reachable here and nowhere else. Getting the app onto a real handset is
 * a separate path (publish, then scan) which `onOpenDevicePanel` leads to.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { DEVICE_PRESETS, getDevicePreset, DEFAULT_DEVICE_ID } from '@/lib/devicePresets';

interface DevicePreviewProps {
  /** Dev-server URL, or undefined before the first successful run. */
  url?: string;
  /** Opens the "preview on your phone" slide-out. */
  onOpenDevicePanel: () => void;
}

/** Padding between the bezel and the edges of the stage, in CSS pixels. */
const STAGE_PADDING = 48;
/** Bezel thickness around the screen, in device pixels (pre-scale). */
const BEZEL = 12;

export function DevicePreview({ url, onOpenDevicePanel }: DevicePreviewProps) {
  const t = useTranslations('ide');
  const [deviceId, setDeviceId] = useState(DEFAULT_DEVICE_ID);
  const [landscape, setLandscape] = useState(false);
  // Bumping this remounts the iframe, which is how we force a reload without
  // touching its contentWindow (cross-origin, so we cannot call location.reload).
  const [reloadKey, setReloadKey] = useState(0);
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const device = getDevicePreset(deviceId);
  const viewportWidth = landscape ? device.height : device.width;
  const viewportHeight = landscape ? device.width : device.height;
  const frameWidth = viewportWidth + BEZEL * 2;
  const frameHeight = viewportHeight + BEZEL * 2;

  // Scale the bezel down to fit the pane. Never scale UP past 1:1 — a phone
  // rendered larger than life misrepresents how big things actually are.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const available = stage.getBoundingClientRect();
      const next = Math.min(
        1,
        (available.width - STAGE_PADDING) / frameWidth,
        (available.height - STAGE_PADDING) / frameHeight,
      );
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [frameWidth, frameHeight]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Simulator toolbar — device, orientation, reload, and the hand-off to a real phone. */}
      <div
        style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '6px 10px', background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {t('device.simulateOnWeb')}
        </span>
        <Select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          aria-label={t('device.deviceLabel')}
          style={{
            background: 'var(--bg-elevated)', color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
            padding: '4px 8px', fontSize: '0.78rem', maxWidth: 170,
          }}
        >
          {DEVICE_PRESETS.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </Select>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {viewportWidth} × {viewportHeight}
          {scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </span>

        <div style={{ flex: 1 }} />

        <ToolbarButton onClick={() => setLandscape((v) => !v)} label={t('device.rotate')} icon="⟳" />
        <ToolbarButton onClick={reload} label={t('device.reload')} icon="↻" disabled={!url} />
        <ToolbarButton
          onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
          label={t('device.openInTab')}
          icon="↗"
          disabled={!url}
        />
        <button
          type="button"
          onClick={onOpenDevicePanel}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
            background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)', borderRadius: 8,
            padding: '4px 10px', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'var(--font-display)',
          }}
        >
          <span aria-hidden>📱</span>
          {t('device.tryOnDevice')}
        </button>
      </div>

      {/* Stage — the scaled device bezel on a recessed backdrop. */}
      <div
        ref={stageRef}
        style={{
          flex: 1, minHeight: 0, overflow: 'auto',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-deep)',
          backgroundImage:
            'radial-gradient(circle at 50% 0%, var(--bg-surface) 0%, transparent 70%)',
        }}
      >
        <div
          style={{
            width: frameWidth * scale,
            height: frameHeight * scale,
            flexShrink: 0,
            display: 'flex',
          }}
        >
          <div
            style={{
              width: frameWidth,
              height: frameHeight,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              padding: BEZEL,
              borderRadius: device.radius + BEZEL,
              background: 'linear-gradient(160deg, #3a3a44, #17171c)',
              boxShadow: '0 18px 50px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.08)',
              position: 'relative',
              flexShrink: 0,
            }}
          >
            {/* Screen */}
            <div
              style={{
                width: viewportWidth,
                height: viewportHeight,
                borderRadius: device.radius,
                overflow: 'hidden',
                background: '#ffffff',
                position: 'relative',
              }}
            >
              {url ? (
                <iframe
                  key={reloadKey}
                  src={url}
                  title={t('device.previewTitle')}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                />
              ) : (
                <div
                  style={{
                    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24,
                    textAlign: 'center', background: 'var(--bg-elevated)', color: 'var(--text-muted)',
                  }}
                >
                  <span style={{ fontSize: 40 }} aria-hidden>📱</span>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {t('device.emptyTitle')}
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>{t('device.emptyHint')}</p>
                </div>
              )}

              {/* Notch / Dynamic Island — cosmetic, and only where the device has one. */}
              {device.notch !== 'none' && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute', top: device.notch === 'dynamic-island' ? 10 : 0,
                    left: '50%', transform: 'translateX(-50%)',
                    width: device.notch === 'dynamic-island' ? 118 : 156,
                    height: device.notch === 'dynamic-island' ? 34 : 28,
                    borderRadius: device.notch === 'dynamic-island' ? 18 : '0 0 16px 16px',
                    background: '#000',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact icon button used across the simulator toolbar. */
function ToolbarButton({ onClick, label, icon, disabled }: {
  onClick: () => void;
  label: string;
  icon: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
        border: '1px solid var(--border-subtle)', borderRadius: 8,
        padding: '4px 9px', fontSize: '0.9rem', lineHeight: 1, flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >
      <span aria-hidden>{icon}</span>
    </button>
  );
}
