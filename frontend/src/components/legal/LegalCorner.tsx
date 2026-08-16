'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLegalDocs } from './useLegalDocs';
import LegalDocModal, { type LegalModalType } from './LegalDocModal';
import ProductUpdatesTrigger from '../releaseNotes/ProductUpdatesTrigger';

/**
 * Version + Terms/Privacy strip for the operator shell, in the BOTTOM-RIGHT
 * corner of the frame.
 *
 * It used to hang off the bottom of the sidebar, where it competed with the
 * rail's navigation for the eye at the exact edge the board wants to be widest.
 * The shell already ends in a footer band (`TeamBar`), so this is the last row
 * of `.app-frame` and sits in normal flow — chrome in the corner can never
 * cover the canvas, and no page has to reserve space for it.
 *
 * The version is a BUTTON, exactly as it is in the marketing footer: both open
 * the one app-wide Product Updates panel (`ProductUpdatesHost`), so the
 * changelog stays reachable from wherever someone happens to be. It carries the
 * legal reader modal with it and decides its own rendering.
 */
export default function LegalCorner() {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const t = useTranslations('legal');
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

  return (
    <>
      <div className="legal-corner" role="group" aria-label={t('navLabel')}>
        <ProductUpdatesTrigger
          appVersion={appVersion}
          apiVersion={apiVersion}
          className="legal-corner-link"
        />
        <button type="button" className="legal-corner-link" onClick={() => setModalType('terms')}>
          {t('termsTitle')}{termsVersion ? ` (v${termsVersion})` : ''}
        </button>
        <button type="button" className="legal-corner-link" onClick={() => setModalType('privacy')}>
          {t('privacyTitle')}{privacyVersion ? ` (v${privacyVersion})` : ''}
        </button>
      </div>

      <LegalDocModal type={modalType} legal={legal} onClose={() => setModalType(null)} />
    </>
  );
}
