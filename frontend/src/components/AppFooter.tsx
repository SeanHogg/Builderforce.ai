'use client';

import { useState } from 'react';
import { useLegalDocs } from './legal/useLegalDocs';
import LegalDocModal, { type LegalModalType } from './legal/LegalDocModal';

/**
 * Page footer with version + Terms/Privacy. Used only by the sidebar-less auth
 * screens (login/register); the rest of the app surfaces the same info via the
 * sidebar's SidebarLegalMenu so it never overlaps content.
 */
export default function AppFooter() {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

  return (
    <>
      <footer className="global-footer">
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
