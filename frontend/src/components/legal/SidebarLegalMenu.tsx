'use client';

import { useState } from 'react';
import { useLegalDocs } from './useLegalDocs';
import LegalDocModal, { type LegalModalType } from './LegalDocModal';

/**
 * Version + Terms/Privacy menu for the sidebar footer. Replaces the old global
 * page footer (which overlapped content) — it decides its own rendering and
 * carries the legal reader modal with it. Hidden when the rail is collapsed,
 * where there's no room for the text (the icons-only rail shows nav glyphs).
 */
export default function SidebarLegalMenu({ collapsed }: { collapsed: boolean }) {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

  if (collapsed) return null;

  return (
    <>
      <div className="nav-legal">
        <span className="nav-legal-version">
          UI {appVersion} · API {apiVersion ?? '…'}
        </span>
        <div className="nav-legal-links">
          <button type="button" className="nav-legal-link" onClick={() => setModalType('terms')}>
            Terms of Use{termsVersion ? ` (v${termsVersion})` : ''}
          </button>
          <button type="button" className="nav-legal-link" onClick={() => setModalType('privacy')}>
            Privacy Policy{privacyVersion ? ` (v${privacyVersion})` : ''}
          </button>
        </div>
      </div>

      <LegalDocModal type={modalType} legal={legal} onClose={() => setModalType(null)} />
    </>
  );
}
