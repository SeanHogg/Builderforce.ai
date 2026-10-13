/**
 * THE page review (PRD 33 §5.2, D14) — the `route` kind's Review tab: one key page
 * as the runner captured it on its newest release, on either device.
 *
 *   • the fold screenshot with numbered callouts for every element the page's fixes
 *     change (numbered in patch-op order over the fixes, `patchCallouts`);
 *   • the score per component (`ScoreRings`) and by release, and the facts the
 *     runner read (`FactMeters`: SEO, content, performance, accessibility);
 *   • the page's fixes, each THE fix card with its rendered before → after, an
 *     "observed from the screen" label on vision findings, and a checkbox that
 *     includes it in ONE prompt for this page (`PagePromptBundle`);
 *   • "Request a capture now" (MANAGER, once an hour).
 *
 * Reads go through the ONE client; a fix's write anywhere reads the review again.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { patchCallouts, type ReplayCaptureDevice, type ReplayPageReviewDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { subscribePrescriptionChanges } from '@/lib/replayPrescriptionsApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { PrescriptionCard } from '../prescriptions/PrescriptionCard';
import { isOpenPrescription } from '../prescriptions/prescriptionModel';
import { PagePromptBundle } from '../prompt/PagePromptBundle';
import { CalloutShot } from './CalloutShot';
import { CaptureNowButton } from './CaptureNowButton';
import { DeviceSwitch } from './DeviceSwitch';
import { FactMeters } from './FactMeters';
import { ScoreRings } from './ScoreRings';
import { useCaptureRects } from './useCaptureAsset';

export interface PageReviewProps {
  siteId: string;
  path: string;
  push?: (level: InsightPanelLevel) => void;
}

const heading = { margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' } as const;

export function PageReview({ siteId, path, push }: PageReviewProps) {
  const t = useTranslations('replay.page');
  const errorText = useErrorText();
  const [review, setReview] = useState<ReplayPageReviewDto | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [device, setDevice] = useState<ReplayCaptureDevice>('desktop');
  // Fixes left OUT of the one prompt (everything open is in by default).
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => subscribePrescriptionChanges(() => setNonce((n) => n + 1)), []);
  useEffect(() => {
    let live = true;
    setError('');
    replayApi.pageReview(siteId, path)
      .then((found) => { if (live) setReview(found); })
      .catch((failure: unknown) => { if (live) setError(errorText(failure)); });
    return () => { live = false; };
    // errorText is a stable formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, path, nonce]);

  const release = review?.captures[0]?.releaseKey ?? null;
  const capture = review?.captures.find((c) => c.releaseKey === release && c.deviceClass === device) ?? null;
  const rects = useCaptureRects(siteId, capture?.id ?? null);
  const fixes = useMemo(() => review?.prescriptions ?? [], [review]);
  const callouts = useMemo(() => patchCallouts({ ops: fixes.flatMap((p) => p.visual?.patch.ops ?? []) }), [fixes]);
  const open = fixes.filter(isOpenPrescription);
  const chosen = open.filter((p) => !excluded.has(p.id));
  const toggle = (id: string, on: boolean) => setExcluded((current) => {
    const next = new Set(current);
    if (on) next.delete(id); else next.add(id);
    return next;
  });

  if (error) return <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('loadFailed')} {error}</p>;
  if (!review) return <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>;

  return (
    <div data-testid="page-review" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <DeviceSwitch value={device} onChange={setDevice} />
        <CaptureNowButton siteId={siteId} path={path} />
      </div>

      {review.captures.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noCaptures')}</p>
      ) : (
        <section aria-label={t('screenTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h3 style={heading}>{t('screenTitle')}{release ? ` · ${t('release', { release: release.slice(0, 12) })}` : ''}</h3>
          {capture ? (
            <CalloutShot path={capture.foldScreenshotUrl} device={device} rects={rects} callouts={callouts} alt={t('foldAlt', { path, device: t(`device.${device}`) })} />
          ) : (
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noDeviceCapture', { device: t(`device.${device}`) })}</p>
          )}
          {callouts.length > 0 && (
            <ol data-testid="page-callouts" style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--font-size-small)' }}>
              {callouts.map((c) => (
                <li key={c.n} data-callout={c.n} style={{ overflowWrap: 'anywhere' }}>
                  {rects.find((r) => r.selector === c.selector)?.label || <code>{c.selector}</code>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {capture && (
        <>
          <section aria-label={t('score.title')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <h3 style={heading}>{t('score.title')}</h3>
            <ScoreRings score={capture.score} />
            {review.scoreByRelease.length > 1 && (
              <ol aria-label={t('score.byRelease')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                {review.scoreByRelease.map((row) => (
                  <li key={row.releaseKey}>{t('score.releaseRow', { release: row.label ?? row.releaseKey.slice(0, 12), score: row.score ?? '—' })}</li>
                ))}
              </ol>
            )}
          </section>
          <section aria-label={t('facts.title')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <h3 style={heading}>{t('facts.title')}</h3>
            <FactMeters capture={capture} />
          </section>
        </>
      )}

      <section aria-label={t('fixesTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <h3 style={heading}>{t('fixesTitle')}</h3>
        {fixes.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('noFixes')}</p>}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {fixes.map((p) => (
            <li key={p.id} data-fix={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
              {isOpenPrescription(p) && (
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 'var(--font-size-small)' }}>
                  <input type="checkbox" checked={!excluded.has(p.id)} onChange={(event) => toggle(p.id, event.currentTarget.checked)} />
                  {t('includeInPrompt')}
                </label>
              )}
              <PrescriptionCard siteId={siteId} prescription={p} push={push} captures={review.captures} device={device} />
            </li>
          ))}
        </ol>
      </section>

      {open.length > 0 && (
        <section aria-label={t('promptTitle')} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h3 style={heading}>{t('promptTitle')}</h3>
          <PagePromptBundle siteId={siteId} path={path} fixes={chosen} />
        </section>
      )}
    </div>
  );
}
