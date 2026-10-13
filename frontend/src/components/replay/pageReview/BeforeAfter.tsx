/**
 * A page-review fix as before → after (PRD 33 §5.2 "Render"): the capture with the
 * patch's numbered callouts, and the runner's render of the page with the patch
 * applied (`visual.afterScreenshotUrls`). Three ways to compare (data:
 * `BEFORE_AFTER_MODES`) — a slider (`input[type=range]`, §4.3), a toggle, or side
 * by side — on either device the capture has. Until the runner has rendered the
 * after, it says so and shows the before.
 */

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { REPLAY_CAPTURE_DEVICES, type ReplayCaptureDevice } from '@builderforce/interaction-contract';
import { CalloutShot, CAPTURE_VIEWPORTS, type Callout } from './CalloutShot';
import { DeviceSwitch } from './DeviceSwitch';
import { useCaptureImage, useCaptureRects } from './useCaptureAsset';

export interface BeforeAfterShot {
  /** The capture the "before" is (its rect map places the callouts). */
  captureId: string | null;
  beforePath: string | null;
  afterPath: string | null;
}

export type BeforeAfterMode = 'slider' | 'toggle' | 'side';
export const BEFORE_AFTER_MODES: readonly BeforeAfterMode[] = ['slider', 'toggle', 'side'];

export interface BeforeAfterProps {
  siteId: string;
  shots: Partial<Record<ReplayCaptureDevice, BeforeAfterShot>>;
  callouts: readonly Callout[];
  initialDevice?: ReplayCaptureDevice;
}

function AfterImage({ path, device, alt, clip }: { path: string; device: ReplayCaptureDevice; alt: string; clip?: number }) {
  const t = useTranslations('replay.page');
  const image = useCaptureImage(path);
  const viewport = CAPTURE_VIEWPORTS[device];
  const overlay = clip !== undefined;
  return (
    <div
      data-testid={overlay ? 'after-overlay' : 'after-shot'}
      data-split={overlay ? clip : undefined}
      style={{
        ...(overlay ? { position: 'absolute', inset: 0, clipPath: `inset(0 0 0 ${clip}%)` } : { position: 'relative', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)' }),
        width: '100%',
        maxWidth: device === 'phone' && !overlay ? 260 : '100%',
        aspectRatio: `${viewport.w} / ${viewport.h}`,
        overflow: 'hidden',
        background: 'var(--surface)',
        pointerEvents: 'none',
      }}
    >
      {image.src
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={image.src} alt={alt} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
        : <p style={{ margin: 0, padding: 'var(--space-2)', fontSize: 'var(--font-size-small)', color: image.failed ? 'var(--error)' : 'var(--text-secondary)' }}>{image.failed ? t('imageFailed') : t('imageLoading')}</p>}
    </div>
  );
}

export function BeforeAfter({ siteId, shots, callouts, initialDevice }: BeforeAfterProps) {
  const t = useTranslations('replay.page.beforeAfter');
  const devices = REPLAY_CAPTURE_DEVICES.filter((d) => shots[d]?.beforePath || shots[d]?.afterPath);
  const [device, setDevice] = useState<ReplayCaptureDevice>(initialDevice && devices.includes(initialDevice) ? initialDevice : devices[0] ?? 'desktop');
  const [mode, setMode] = useState<BeforeAfterMode>('slider');
  const [split, setSplit] = useState(50);
  const [showAfter, setShowAfter] = useState(false);
  const shot = shots[device];
  const rects = useCaptureRects(siteId, shot?.captureId ?? null);
  if (!shot) return null;

  const before = <CalloutShot path={shot.beforePath} device={device} rects={rects} callouts={callouts} alt={t('beforeAlt')} />;
  const afterPath = shot.afterPath;

  let body: ReactNode;
  if (!afterPath) {
    body = (
      <>
        {before}
        <p role="status" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('afterPending')}</p>
      </>
    );
  } else if (mode === 'slider') {
    body = (
      <>
        <div style={{ position: 'relative', width: '100%', maxWidth: device === 'phone' ? 260 : '100%' }}>
          {before}
          <AfterImage path={afterPath} device={device} alt={t('afterAlt')} clip={split} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={split}
          aria-label={t('sliderAria')}
          onChange={(event) => setSplit(Number(event.currentTarget.value))}
          style={{ width: '100%', maxWidth: device === 'phone' ? 260 : '100%', minHeight: 44 }}
        />
      </>
    );
  } else if (mode === 'toggle') {
    body = (
      <>
        <div role="tablist" aria-label={t('toggleAria')} style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {[false, true].map((after) => (
            <button key={String(after)} type="button" role="tab" aria-selected={showAfter === after} className={showAfter === after ? 'btn-secondary' : 'btn-ghost'} style={{ minHeight: 44 }} onClick={() => setShowAfter(after)}>
              {after ? t('after') : t('before')}
            </button>
          ))}
        </div>
        {showAfter ? <AfterImage path={afterPath} device={device} alt={t('afterAlt')} /> : before}
      </>
    );
  } else {
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-2)', alignItems: 'start' }}>
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {before}
          <figcaption style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('before')}</figcaption>
        </figure>
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <AfterImage path={afterPath} device={device} alt={t('afterAlt')} />
          <figcaption style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('after')}</figcaption>
        </figure>
      </div>
    );
  }

  return (
    <section aria-label={t('title')} data-testid="before-after" data-mode={mode} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', justifyContent: 'space-between' }}>
        {devices.length > 1 ? <DeviceSwitch value={device} devices={devices} onChange={setDevice} /> : <span />}
        {afterPath && (
          <div role="tablist" aria-label={t('modeAria')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
            {BEFORE_AFTER_MODES.map((m) => (
              <button key={m} type="button" role="tab" data-mode={m} aria-selected={mode === m} className={mode === m ? 'btn-secondary' : 'btn-ghost'} style={{ minHeight: 44 }} onClick={() => setMode(m)}>
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      {body}
    </section>
  );
}
