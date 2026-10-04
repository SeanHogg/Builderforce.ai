import { useTranslations } from 'next-intl';
import type { CanvasVideoSource, CanvasVideoTimeline } from '@builderforce/creation-canvas-contract';
import { usePlanFeature } from '@/lib/useConsumption';
import { useServerMovieRender, type ServerMovieRendition } from '@/hooks/useServerMovieRender';

/**
 * "Render on server" — the paid twin of the browser export. Renders nothing
 * unless the tenant holds `serverVideoRender`; the browser export stays the
 * path on every plan. The render is a server job, so the tab can close: the
 * job id lives on the object and the next visit lands the finished MP4.
 */
export function ServerMovieRenderButton({ timeline, sources, pendingJobId, disabled, onJobChange, onRendered }: {
  timeline: CanvasVideoTimeline;
  sources: readonly CanvasVideoSource[];
  pendingJobId: string | null;
  disabled?: boolean;
  onJobChange: (jobId: string | null) => void;
  onRendered: (rendition: ServerMovieRendition) => void;
}) {
  const t = useTranslations('creationCanvas.videoEditor');
  const entitled = usePlanFeature('serverVideoRender');
  const render = useServerMovieRender({ pendingJobId, onJobChange, onRendered });
  // A job already running still finishes and lands even if the plan has since lapsed.
  if (!entitled && !pendingJobId) return null;
  const working = render.phase === 'starting' || render.phase === 'rendering';
  return <>
    {entitled && (
      <button type="button" disabled={disabled || working || !timeline.clips.length} title={t('serverRenderHint')} onClick={() => void render.start(timeline, sources)}>
        {working ? t('serverRendering') : t('renderOnServer')}
      </button>
    )}
    {render.phase === 'rendering' && <span role="status">{t('serverRenderRunning')}</span>}
    {render.error && <span role="alert">{t('serverRenderFailed', { reason: render.error })}</span>}
  </>;
}
