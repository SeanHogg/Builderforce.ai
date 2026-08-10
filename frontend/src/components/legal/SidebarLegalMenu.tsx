'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLegalDocs } from './useLegalDocs';
import LegalDocModal, { type LegalModalType } from './LegalDocModal';
import { openProductUpdates } from '@/lib/productUpdates';

/**
 * Version + Terms/Privacy menu for the sidebar footer. Replaces the old global
 * page footer (which overlapped content) — it decides its own rendering and
 * carries the legal reader modal with it. Hidden when the rail is collapsed,
 * where there's no room for the text (the icons-only rail shows nav glyphs).
 *
 * The version is a BUTTON here, exactly as it is in the marketing footer: the
 * in-app shell has no footer, so this was the only version on screen for a
 * signed-in user and it did nothing. Both open the one app-wide Product Updates
 * panel (`ProductUpdatesHost`), so the changelog is now reachable from wherever
 * someone happens to be.
 */
export default function SidebarLegalMenu({ collapsed }: { collapsed: boolean }) {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const t = useTranslations('legal');
  const tFooter = useTranslations('footer');
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

  if (collapsed) return null;

  return (
    <>
      <div className="nav-legal">
        <button
          type="button"
          className="nav-legal-version"
          onClick={openProductUpdates}
          title={tFooter('whatsNewHint')}
        >
          UI {appVersion} · API {apiVersion ?? '…'}
        </button>
        <div className="nav-legal-links">
          <button type="button" className="nav-legal-link" onClick={() => setModalType('terms')}>
            {t('termsTitle')}{termsVersion ? ` (v${termsVersion})` : ''}
          </button>
          <button type="button" className="nav-legal-link" onClick={() => setModalType('privacy')}>
            {t('privacyTitle')}{privacyVersion ? ` (v${privacyVersion})` : ''}
          </button>
        </div>
      </div>

      <LegalDocModal type={modalType} legal={legal} onClose={() => setModalType(null)} />
    </>
  );
}
