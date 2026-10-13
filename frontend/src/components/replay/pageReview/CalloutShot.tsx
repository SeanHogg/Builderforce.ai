/**
 * A page capture's fold screenshot with numbered callouts (PRD 33 §5.2 "Render"):
 * each element a fix's visual patch touches, numbered in patch-op order
 * (`patchCallouts`), drawn where the capture's rect map says it sits. The fold is
 * the capture viewport, so a callout below it is listed but not drawn on the image.
 * Markers are buttons with an `aria-label` (§4.3).
 */

import { useTranslations } from 'next-intl';
import type { PageRect, ReplayCaptureDevice } from '@builderforce/interaction-contract';
import { useCaptureImage } from './useCaptureAsset';

/** The runner's capture viewports (§5.2: 1440×900 and 390×844). */
export const CAPTURE_VIEWPORTS: Readonly<Record<ReplayCaptureDevice, { w: number; h: number }>> = {
  desktop: { w: 1440, h: 900 },
  phone: { w: 390, h: 844 },
};

export interface Callout {
  n: number;
  selector: string;
}

export interface CalloutShotProps {
  /** A `capturesAsset` path (fold screenshot or an after render); null → an honest "no capture". */
  path: string | null;
  device: ReplayCaptureDevice;
  rects: readonly PageRect[];
  callouts: readonly Callout[];
  /** Accessible name of the image. */
  alt: string;
  onSelectCallout?: (callout: Callout) => void;
}

const pct = (value: number, of: number) => `${Math.max(0, Math.min(100, (value / of) * 100))}%`;

export function CalloutShot({ path, device, rects, callouts, alt, onSelectCallout }: CalloutShotProps) {
  const t = useTranslations('replay.page');
  const image = useCaptureImage(path);
  const viewport = CAPTURE_VIEWPORTS[device];
  const placed = callouts.flatMap((callout) => {
    const rect = rects.find((r) => r.selector === callout.selector);
    return rect && rect.y < viewport.h ? [{ callout, rect }] : [];
  });

  if (!path) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noCapture')}</p>;
  return (
    <div
      data-testid="callout-shot"
      data-device={device}
      style={{ position: 'relative', width: '100%', maxWidth: device === 'phone' ? 260 : '100%', aspectRatio: `${viewport.w} / ${viewport.h}`, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--surface)' }}
    >
      {image.src ? (
        // An object URL from an authorised fetch; next/image cannot optimise a blob.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image.src} alt={alt} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
      ) : (
        <p role={image.failed ? 'alert' : 'status'} style={{ margin: 0, padding: 'var(--space-2)', color: image.failed ? 'var(--error)' : 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {image.failed ? t('imageFailed') : t('imageLoading')}
        </p>
      )}
      {placed.map(({ callout, rect }) => (
        <button
          key={`${callout.n}:${callout.selector}`}
          type="button"
          data-callout={callout.n}
          aria-label={t('calloutAria', { n: callout.n, element: rect.label || callout.selector })}
          onClick={() => onSelectCallout?.(callout)}
          style={{
            position: 'absolute',
            left: pct(rect.x, viewport.w),
            top: pct(rect.y, viewport.h),
            width: pct(rect.w, viewport.w),
            height: pct(rect.h, viewport.h),
            minWidth: 44,
            minHeight: 44,
            padding: 0,
            border: '2px solid var(--accent)',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            cursor: onSelectCallout ? 'pointer' : 'default',
          }}
        >
          <span
            aria-hidden="true"
            style={{ position: 'absolute', top: -2, left: -2, minWidth: 22, height: 22, padding: '0 4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-full)', background: 'var(--accent)', color: 'var(--surface-card)', fontSize: 'var(--font-size-small)', fontWeight: 700 }}
          >
            {callout.n}
          </span>
        </button>
      ))}
    </div>
  );
}
