/**
 * "Publish as preview for this fix" (PRD 33 §5.1.4, S4e): the workspace was opened
 * from an Insights fix (`?prescription=<id>`, see `studioFixPreviewHref`). A cloud
 * run edited this project's workspace; a PERSON builds it here, in the browser,
 * and publishes the build as a PREVIEW release. The release lands beside the live
 * one and is recorded on the fix — the live site does not move; the person reviews
 * the preview through a short-lived private link and publishes from Insights.
 *
 * Decides its own visibility: nothing without a fix in the address. The build is the
 * panel's own (`onBuild`); the upload is `publishSitePreview`.
 */

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { publishSitePreview, type SitePreviewResult } from '@/lib/api';
import { faultText } from '@/lib/apiClient';
import { replayApi } from '@/lib/replayApi';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { studioPublishLinkFrom } from '@/lib/studio/studioDeepLink';
import { INSIGHTS_APP_PATH, insightsAppHref } from '@/components/replay/prescriptions/useInsightsLevel';
import { withPanelParams } from '@/components/insights/panelUrl';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';

interface PrescriptionPreviewPublishProps {
  projectId: number;
  /** Build the project and return its dist assets — the same builder Publish uses. */
  onBuild: () => Promise<Array<{ path: string; data: Uint8Array }>>;
}

type Phase = 'idle' | 'building' | 'uploading' | 'done' | 'error';

interface Published {
  result: SitePreviewResult;
  /** The short-lived signed link, or null when it could not be minted (the fix in Insights can mint it). */
  previewUrl: string | null;
  insightsHref: string;
}

const linkStyle = { color: 'var(--accent)', fontWeight: 600, overflowWrap: 'anywhere' } as const;

export function PrescriptionPreviewPublish({ projectId, onBuild }: PrescriptionPreviewPublishProps) {
  const t = useTranslations('ide');
  const prescriptionId = studioPublishLinkFrom(useSearchParams() ?? new URLSearchParams()).prescriptionId;
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [published, setPublished] = useState<Published | null>(null);

  const publish = useCallback(async () => {
    if (!prescriptionId) return;
    setError('');
    setPublished(null);
    setPhase('building');
    try {
      const assets = await onBuild();
      setPhase('uploading');
      const result = await publishSitePreview(projectId, assets, prescriptionId);
      // The signed link and the way back both need the Insights site behind this project.
      const site = await replaySitesApi.projectSite(projectId).catch(() => null);
      const previewUrl = site ? await replayApi.previewUrl(site.id, result.versionToken).then((link) => link.url).catch(() => null) : null;
      const level: InsightPanelLevel = { kind: 'fix', id: prescriptionId };
      setPublished({
        result,
        previewUrl,
        insightsHref: site ? insightsAppHref(site.id, level) : `${INSIGHTS_APP_PATH}?${withPanelParams(new URLSearchParams(), level).toString()}`,
      });
      setPhase('done');
    } catch (cause) {
      setError(faultText(cause, t('publish.fixPreview.failed')));
      setPhase('error');
    }
  }, [prescriptionId, onBuild, projectId, t]);

  if (!prescriptionId) return null;
  const busy = phase === 'building' || phase === 'uploading';

  return (
    <section
      aria-label={t('publish.fixPreview.title')}
      data-testid="prescription-preview-publish"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)' }}
    >
      <div style={{ fontWeight: 600 }}>{t('publish.fixPreview.title')}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>{t('publish.fixPreview.description')}</div>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void publish()}
        disabled={busy}
        aria-busy={busy}
        style={{ minHeight: 44 }}
      >
        {phase === 'building' ? t('publish.building') : phase === 'uploading' ? t('publish.uploading') : t('publish.fixPreview.action')}
      </button>
      {error && <div role="alert" style={{ color: 'var(--error)', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{error}</div>}
      {published && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            {t('publish.fixPreview.done')} · {t('publish.fileCount', { count: published.result.assetCount })}
          </span>
          {published.previewUrl ? (
            <>
              <a href={published.previewUrl} target="_blank" rel="noreferrer" style={linkStyle}>{t('publish.fixPreview.openPreview')}</a>
              <span style={{ color: 'var(--text-muted)' }}>{t('publish.fixPreview.linkNote')}</span>
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>{t('publish.fixPreview.noLink')}</span>
          )}
          <Link href={published.insightsHref} style={linkStyle}>{t('publish.fixPreview.backToFix')}</Link>
        </div>
      )}
    </section>
  );
}
