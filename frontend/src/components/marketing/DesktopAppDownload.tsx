import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { renderInlineCode } from './inlineCode';

/** Releases of the desktop app carry `desktop-v*` tags; this lists exactly those. */
const DESKTOP_RELEASES_URL = 'https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true';
const DESKTOP_POST_PATH = '/blog/one-local-index-for-every-ai-tool';

/**
 * The Builderforce Desktop download section — what the app does, where to get it, and
 * that it stays local. Self-contained: it owns its copy (`desktopApp` catalog) and its
 * links, so any marketing surface can drop it in with no props.
 */
export default async function DesktopAppDownload() {
  const t = await getTranslations('desktopApp');
  const points = t.raw('points') as string[];
  return (
    <section className="cc-section" aria-labelledby="desktop-app-heading">
      <h2 id="desktop-app-heading" className="cc-h2">
        <span className="cc-agentHost-accent">⟩</span> {t('heading')}
      </h2>
      <p className="cc-prose">{t('intro')}</p>
      <ul className="cc-prose-list">
        {points.map((point, i) => (
          <li key={i}>{renderInlineCode(point)}</li>
        ))}
      </ul>
      <p className="cc-prose">{t('privacy')}</p>
      <div className="cc-cta-row">
        <a href={DESKTOP_RELEASES_URL} className="cc-link-cta" target="_blank" rel="noopener noreferrer">
          {t('download')} →
        </a>
        <Link href={DESKTOP_POST_PATH} className="cc-link-cta">
          {t('readMore')} →
        </Link>
      </div>
    </section>
  );
}
