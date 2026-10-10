import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { renderInlineCode } from './inlineCode';

/** Releases of the desktop app carry `desktop-v*` tags; this lists exactly those. */
const DESKTOP_RELEASES_URL = 'https://github.com/SeanHogg/Builderforce.ai/releases?q=desktop-v&expanded=true';
const DESKTOP_POST_PATH = '/blog/your-private-evermind-on-your-machine';

type Point = { title: string; desc: string };

/**
 * The Synapse section — what the desktop app is (each person's private Evermind, on
 * their own machine), what it does, where to get it, and that it stays local.
 *
 * Self-contained: it owns its copy (`desktopApp` catalog), its links AND its styles
 * (`syn-*`, drawn from the theme tokens), so `/agents`, `/evermind` and `/features` drop
 * it in with no props and no page stylesheet to borrow from.
 */
export default async function DesktopAppDownload() {
  const t = await getTranslations('desktopApp');
  const points = t.raw('points') as Point[];
  return (
    <section className="syn" aria-labelledby="synapse-heading">
      <style>{`
        .syn { max-width: var(--marketing-max, 1200px); margin: 0 auto; padding: 0 var(--marketing-gutter, 20px) 64px; width: 100%; }
        .syn-eyebrow { display: inline-block; font-family: var(--font-display); font-size: var(--font-size-eyebrow); font-weight: 600;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--cyan-bright); border: 1px solid var(--border-accent);
          border-radius: var(--radius-full, 999px); padding: 4px 14px; margin-bottom: 14px; }
        .syn-h2 { font-family: var(--font-display); font-weight: 700; font-size: var(--font-size-section); color: var(--text-primary); margin: 0 0 10px; }
        .syn-lead { font-size: var(--font-size-card-title); color: var(--text-secondary); line-height: 1.7; max-width: 820px; margin: 0 0 24px; }
        .syn-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 14px; }
        .syn-card { background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-xl, 16px); padding: 20px; }
        .syn-card h3 { font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-body); color: var(--text-primary); margin: 0 0 6px; }
        .syn-card p { font-size: var(--font-size-small); color: var(--text-secondary); line-height: 1.6; margin: 0; }
        .syn-privacy { font-size: var(--font-size-small); color: var(--text-muted); margin: 18px 0 0; }
        .syn-cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
        .syn-cta a { display: inline-flex; align-items: center; gap: 6px; padding: 12px 22px; border-radius: var(--radius-lg, 12px);
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-small); text-decoration: none; }
        .syn-cta .syn-primary { background: linear-gradient(135deg, var(--coral-bright), var(--coral-dark)); color: var(--text-on-accent); }
        .syn-cta .syn-ghost { border: 1px solid var(--border-subtle); background: var(--surface-card); color: var(--text-primary); }
        .syn-cta .syn-ghost:hover { border-color: var(--border-accent); }
      `}</style>
      <span className="syn-eyebrow">{t('eyebrow')}</span>
      <h2 id="synapse-heading" className="syn-h2">{t('heading')}</h2>
      <p className="syn-lead">{t('intro')}</p>
      <div className="syn-grid">
        {points.map((point) => (
          <div key={point.title} className="syn-card">
            <h3>{point.title}</h3>
            <p>{renderInlineCode(point.desc)}</p>
          </div>
        ))}
      </div>
      <p className="syn-privacy">{t('privacy')}</p>
      <div className="syn-cta">
        <a href={DESKTOP_RELEASES_URL} className="syn-primary" target="_blank" rel="noopener noreferrer">
          {t('download')} →
        </a>
        <Link href={DESKTOP_POST_PATH} className="syn-ghost">
          {t('readMore')} →
        </Link>
      </div>
    </section>
  );
}
