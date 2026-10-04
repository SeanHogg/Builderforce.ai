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

/**
 * The running app, and nothing else. Its address, reload and open-in-tab live in
 * the preview toolbar, and what to show before there is a URL (starting,
 * failed, nothing yet) is `PreviewStatus` — so this renders nothing without one.
 */
export function PreviewFrame({ url, frameRef }: PreviewFrameProps) {
  const t = useTranslations('ide');
  if (!url) return null;
  return (
    <iframe
      ref={frameRef}
      src={url}
      title={t('previewTitle')}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      style={{ display: 'block', width: '100%', height: '100%', border: 0, background: 'var(--bg-surface)' }}
    />
  );
}
