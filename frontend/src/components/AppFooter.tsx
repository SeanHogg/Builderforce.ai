'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLegalDocs } from './legal/useLegalDocs';
import LegalDocModal, { type LegalModalType } from './legal/LegalDocModal';
import { FOOTER_LINKS, BRAND } from '@/lib/content';

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
 * Site-links markup is inline-styled on purpose: the shared `global-footer`
 * classes live in T2-owned `globals.css`, so this T1 component carries its own.
 */
export default function AppFooter({ variant = 'legal' }: { variant?: 'legal' | 'full' }) {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

  return (
    <>
      <footer className="global-footer">
        {variant === 'full' && (
          <div
            style={{
              maxWidth: 1200,
              margin: '0 auto',
              padding: '28px 14px 4px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <ul
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 2,
                listStyle: 'none',
                padding: 0,
                margin: 0,
              }}
            >
              {FOOTER_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    style={{
                      fontSize: '0.82rem',
                      color: 'var(--text-muted)',
                      textDecoration: 'none',
                      padding: '4px 10px',
                      borderRadius: 6,
                    }}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
              Built by{' '}
              <a
                href={BRAND.founder.url}
                target="_blank"
                rel="noopener"
                style={{ color: 'var(--coral-bright)', textDecoration: 'none' }}
              >
                {BRAND.founder.name}
              </a>
              {' '}· {BRAND.name} © {BRAND.year}
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
