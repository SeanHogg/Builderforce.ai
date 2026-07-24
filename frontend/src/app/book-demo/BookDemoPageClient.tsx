'use client';

/**
 * /book-demo — public "schedule a demo with sales" page (migration 0360).
 * Two paths side by side: talk to sales (the shared BookDemoForm) or jump into a
 * self-serve live demo (links back to the landing's demo section). Fully
 * localized + theme-token driven, mobile-first.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookDemoForm } from '@/components/demo/BookDemoForm';

export default function BookDemoPageClient() {
  const t = useTranslations('bookDemo');

  return (
    <div className="bdp">
      <div className="bdp-inner">
        <header className="bdp-head">
          <span className="bdp-badge">{t('badge')}</span>
          <h1 className="bdp-title">{t('pageTitle')}</h1>
          <p className="bdp-lead">{t('pageLead')}</p>
        </header>

        <div className="bdp-grid">
          <section className="bdp-card">
            <h2 className="bdp-card-title">{t('formHeading')}</h2>
            <p className="bdp-card-sub">{t('formSub')}</p>
            <BookDemoForm source="book-demo-page" />
          </section>

          <aside className="bdp-card bdp-card-alt">
            <h2 className="bdp-card-title">{t('selfServeHeading')}</h2>
            <p className="bdp-card-sub">{t('selfServeSub')}</p>
            <ul className="bdp-list">
              <li>{t('selfServe1')}</li>
              <li>{t('selfServe2')}</li>
              <li>{t('selfServe3')}</li>
            </ul>
            <Link href="/#demos" className="bdp-cta">{t('selfServeCta')} →</Link>
          </aside>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .bdp { padding: clamp(24px, 5vw, 56px) 16px; }
  .bdp-inner { max-width: 960px; margin: 0 auto; }
  .bdp-head { text-align: center; margin-bottom: 32px; }
  .bdp-badge {
    display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 4px 10px; border-radius: 999px; margin-bottom: 12px;
    background: var(--surface-cyan-soft, rgba(0,229,204,0.16)); color: var(--cyan-bright, #00e5cc);
  }
  .bdp-title { margin: 0 0 10px; font-size: clamp(26px, 4vw, 38px); font-weight: 800; color: var(--text-primary, #f0f4ff); }
  .bdp-lead { margin: 0 auto; max-width: 620px; font-size: 16px; line-height: 1.6; color: var(--text-secondary, #aab3c5); }
  .bdp-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 20px; align-items: start; }
  @media (max-width: 760px) { .bdp-grid { grid-template-columns: 1fr; } }
  .bdp-card {
    padding: 24px; border-radius: 18px;
    background: var(--surface-card, rgba(255,255,255,0.03));
    border: 1px solid var(--border, rgba(255,255,255,0.12));
  }
  .bdp-card-alt { background: var(--surface-2, rgba(255,255,255,0.05)); }
  .bdp-card-title { margin: 0 0 6px; font-size: 20px; font-weight: 700; color: var(--text-primary, #f0f4ff); }
  .bdp-card-sub { margin: 0 0 18px; font-size: 14px; line-height: 1.5; color: var(--text-secondary, #aab3c5); }
  .bdp-list { margin: 0 0 20px; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; }
  .bdp-list li { font-size: 14px; line-height: 1.5; color: var(--text-secondary, #aab3c5); }
  .bdp-cta {
    display: inline-block; padding: 11px 18px; border-radius: 10px; text-decoration: none;
    background: var(--accent, #4d9eff); color: #fff; font-weight: 700; font-size: 15px;
  }
`;
