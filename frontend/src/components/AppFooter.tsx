'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLegalDocs } from './legal/useLegalDocs';
import LegalDocModal, { type LegalModalType } from './legal/LegalDocModal';
import { openProductUpdates } from '@/lib/productUpdates';
import { BRAND, STATS } from '@/lib/content';
import { destTitleKey, footerColumns } from '@/lib/navGroups';
import { seatHueVar } from '@/lib/seats';

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
  // Column titles are the footer's own copy; the LINK labels are the
  // destination's, wherever the registry keeps it. Same rule as the header.
  const tRoot = useTranslations();
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

  // Version + legal strip. Rendered under the copyright credit in the marketing
  // (`full`) footer; rendered as its own bottom row in the slim (`legal`) footer.
  const versionStrip = (
    <div className={`global-footer-inner${variant === 'legal' ? ' global-footer-inner--legal' : ''}`}>
      {variant === 'legal' && (
        <span className="global-footer-copyright">{BRAND.name} © {BRAND.year}</span>
      )}
      <button
        type="button"
        onClick={openProductUpdates}
        className="global-footer-link"
        title={t('whatsNewHint')}
      >
        UI {appVersion} · API {apiVersion ?? '…'}
      </button>
      <div className="global-footer-links">
        <button type="button" onClick={() => window.dispatchEvent(new Event('builderforce:cookie-preferences'))} className="global-footer-link">{t('cookies')}</button>
        <Link href="/legal/subprocessors" className="global-footer-link">{t('subprocessors')}</Link>
        <Link href="/legal/accessibility" className="global-footer-link">{t('accessibility')}</Link>
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
              <p className="global-footer-summary">{STATS.quotable.creativeCanvas}</p>
              <p className="global-footer-credit">
                {t('builtBy')}{' '}
                <a href={BRAND.founder.url} target="_blank" rel="noopener">
                  {BRAND.founder.name}
                </a>{' '}
                · {BRAND.name} © {BRAND.year}
              </p>
              {versionStrip}
            </div>

            {/* Four projections of the destination registry, not a fifth list.
                It WAS a fifth list, and it showed: the storefront was "Workforce
                Registry" here and "Marketplace" everywhere else, and the column
                still offered an `/agents` destination that had been folded into
                it. A footer link now cannot name a place the product does not. */}
            <nav className="global-footer-cols" aria-label={t('navLabel')}>
              {footerColumns().map((col) => (
                <div key={col.titleKey} className="global-footer-col">
                  <h3>{t(col.titleKey)}</h3>
                  <ul>
                    {col.links.map((l) => (
                      <li key={l.id}>
                        <Link
                          href={l.marketingHref}
                          style={{ '--seat': `var(${seatHueVar(l.seat)})` } as React.CSSProperties}
                        >
                          {tRoot(destTitleKey(l))}
                        </Link>
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
    </>
  );
}
