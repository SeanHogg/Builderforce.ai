'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useLegalDocs } from './legal/useLegalDocs';
import LegalDocModal, { type LegalModalType } from './legal/LegalDocModal';
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
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

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
                Built by{' '}
                <a href={BRAND.founder.url} target="_blank" rel="noopener">
                  {BRAND.founder.name}
                </a>{' '}
                · {BRAND.name} © {BRAND.year}
              </p>
            </div>

            <nav className="global-footer-cols" aria-label="Footer">
              {FOOTER_COLUMNS.map((col) => (
                <div key={col.title} className="global-footer-col">
                  <h3>{col.title}</h3>
                  <ul>
                    {col.links.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href}>{l.label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>
        )}

        <div className="global-footer-inner">
          <span>
            UI {appVersion} · API {apiVersion ?? '…'}
          </span>
          <div className="global-footer-links">
            <button
              type="button"
              onClick={() => setModalType('terms')}
              className="global-footer-link"
            >
              Terms of Use{termsVersion ? ` (v${termsVersion})` : ''}
            </button>
            <button
              type="button"
              onClick={() => setModalType('privacy')}
              className="global-footer-link"
            >
              Privacy Policy{privacyVersion ? ` (v${privacyVersion})` : ''}
            </button>
          </div>
        </div>
      </footer>

      <LegalDocModal type={modalType} legal={legal} onClose={() => setModalType(null)} />
    </>
  );
}
