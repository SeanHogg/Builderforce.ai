'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useLegalDocs } from './legal/useLegalDocs';
import LegalDocModal, { type LegalModalType } from './legal/LegalDocModal';
import { FOOTER_LINKS, BRAND, STATS } from '@/lib/content';

/**
 * The single canonical site footer.
 *
 * - `variant="legal"` (default) — the slim version + Terms/Privacy strip used by
 *   the sidebar-less auth screens (login/register), where vertical space is
 *   constrained.
 * - `variant="full"` — the same legal strip PLUS the marketing site-links
 *   (`FOOTER_LINKS`) + copyright. Rendered once by `PublicShell` so every
 *   marketing/browse route shares ONE footer instead of stacking a per-page
 *   `.lp-footer`/`.pp-footer`/`.cmp-footer` above this legal strip.
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
            <p className="global-footer-summary">
              <Link href="/" aria-label={`${BRAND.name} home`} className="global-footer-mascot-link">
                <Image
                  src="/agentHost.png"
                  alt={`${BRAND.name} — ${BRAND.tagline}`}
                  width={28}
                  height={28}
                  className="global-footer-mascot"
                />
              </Link>
              {STATS.quotable.humanInLoopAgentic}
            </p>

            <nav aria-label="Footer">
              <ul className="global-footer-nav">
                {FOOTER_LINKS.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>

            <p className="global-footer-credit">
              Built by{' '}
              <a href={BRAND.founder.url} target="_blank" rel="noopener">
                {BRAND.founder.name}
              </a>{' '}
              · {BRAND.name} © {BRAND.year}
            </p>
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
