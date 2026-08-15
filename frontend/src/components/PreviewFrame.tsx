'use client';

import { Icon } from '@/components/ui/Icon';
import { useTranslations } from 'next-intl';

interface PreviewFrameProps {
  url?: string;
  /**
   * Handle on the preview document, so the host can talk to the overlay injected
   * into it — arming click-to-source selection. The frame is cross-origin (it is
   * the dev server), so `postMessage` is the only channel, and it needs the
   * window this ref carries.
   */
  frameRef?: React.Ref<HTMLIFrameElement>;
}

export function PreviewFrame({ url, frameRef }: PreviewFrameProps) {
  const t = useTranslations('ide');

  if (!url) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ background: 'var(--bg-deep)', color: 'var(--text-muted)' }}
      >
        <div className="text-center">
          <div className="text-4xl mb-3"><Icon source="🌐" size="1em" /></div>
          <p className="text-sm">{t('previewEmpty')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--surface)' }}>
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{url}</span>
        <button
          onClick={() => window.open(url, '_blank')}
          className="text-xs whitespace-nowrap"
          style={{ color: 'var(--accent)' }}
        >
          {t('previewOpen')} <Icon source="↗" size="1em" />
        </button>
      </div>
      <iframe
        ref={frameRef}
        src={url}
        className="flex-1 w-full"
        title={t('previewTitle')}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
