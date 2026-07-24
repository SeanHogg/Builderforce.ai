'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLegalDocs } from './legal/useLegalDocs';
import LegalDocModal, { type LegalModalType } from './legal/LegalDocModal';
import WhatsNewPanel from './WhatsNewPanel';
import { FOOTER_COLUMNS, BRAND, STATS } from '@/lib/content';

/**
 * The single canonical site footer.
 *
 * - `variant="legal"` (default) — the slim version + Terms/Privacy strip used by
 *   the sidebar-less auth screens (login/register), where vertical space is
 *   constrained.
 * - `variant="full"` — the same legal strip PLUS the marketing brand block
 *   (mascot + SEO summary) and grouped link columns (`FOOTER_COLUMNS`).
 *   Rendered once by `PublicShell` so every marketing/browse route shares ONE
 *   footer instead of stacking a per-page `.lp-footer`/`.pp-footer`/`.cmp-footer`.
 *
 * The marketing (`full`) footer markup uses the `global-footer-*` classes in
 * `globals.css`; the mascot retired from the homepage hero lives here now.
 */
export default function AppFooter({ variant = 'legal' }: { variant?: 'legal' | 'full' }) {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const t = useTranslations('footer');
  const searchParams = useSearchParams();
  const [modalType, setModalType] = useState<LegalModalType | null>(null);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  // Deep link from the weekly release-digest email CTA (`?whatsnew=1`) opens the
  // panel straight away, so a reader lands on exactly what the mail announced.
  useEffect(() => {
    if (searchParams?.get('whatsnew') === '1') setWhatsNewOpen(true);
  }, [searchParams]);

  // Version + legal strip. Rendered under the copyright credit in the marketing
  // (`full`) footer; rendered as its own bottom row in the slim (`legal`) footer.
  const versionStrip = (
    <div className="global-footer-inner">
      <button
        type="button"
        onClick={() => setWhatsNewOpen(true)}
        className="global-footer-link"
        title={t('whatsNewHint')}
      >
        UI {appVersion} · API {apiVersion ?? '…'}
      </button>
      <div className="global-footer-links">
        <button
          type="button"
          onClick={() => setModalType('terms')}
          className="global-footer-link"
        >
          {t('termsOfUse')}{termsVersion ? ` (v${termsVersion})` : ''}
        </button>
        <button
          type="button"
          onClick={() => setModalType('privacy')}
          className="global-footer-link"
        >
          {t('privacyPolicy')}{privacyVersion ? ` (v${privacyVersion})` : ''}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <footer className="global-footer">
        {variant === 'full' && (
          <div className="global-footer-full">
            <div className="global-footer-brand">
              <Link href="/" aria-label={`${BRAND.name} home`} className="global-footer-brand-mark">
                <Image
                  src="/agentHost.png"
                  alt=""
                  width={32}
                  height={32}
                  className="global-footer-mascot"
                />
                <span>{BRAND.name}</span>
              </Link>
              <p className="global-footer-summary">{STATS.quotable.humanInLoopAgentic}</p>
              <p className="global-footer-credit">
                {t('builtBy')}{' '}
                <a href={BRAND.founder.url} target="_blank" rel="noopener">
                  {BRAND.founder.name}
                </a>{' '}
                · {BRAND.name} © {BRAND.year}
              </p>
              {versionStrip}
            </div>

            <nav className="global-footer-cols" aria-label={t('navLabel')}>
              {FOOTER_COLUMNS.map((col) => (
                <div key={col.titleKey} className="global-footer-col">
                  <h3>{t(col.titleKey)}</h3>
                  <ul>
                    {col.links.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href}>{t(l.labelKey)}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        )}

        {variant === 'legal' && versionStrip}
      </footer>

      <LegalDocModal type={modalType} legal={legal} onClose={() => setModalType(null)} />
      <WhatsNewPanel open={whatsNewOpen} onClose={() => setWhatsNewOpen(false)} />
    </>
  );
}
