'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLegalDocs } from './useLegalDocs';
import LegalDocModal, { type LegalModalType } from './LegalDocModal';
import LegalDocLink from './LegalDocLink';
import ProductUpdatesTrigger from '../releaseNotes/ProductUpdatesTrigger';
import { BRAND } from '@/lib/content';

/**
 * Copyright + version + Terms/Privacy — the row itself, with nowhere it decides
 * to render.
 *
 * Shared so the SAME row can sit in different layout contexts without
 * duplicating the fetch, the modal state and the markup: the sidebar rail
 * (`Sidebar`, as the last row of the nav, off the board entirely) and the
 * canvas's docked Brain panel (`BrainDock`, in normal flow as that panel's
 * own footer — never a floating overlay competing with the board's chrome).
 * Each caller owns ONLY where it sits and whether it renders at all.
 */
export function LegalStrip({ className }: { className: string }) {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const t = useTranslations('legal');
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

  return (
    <>
      <div className={className} role="group" aria-label={t('navLabel')}>
        <span>
          <span className="legal-corner-brand">{BRAND.name} </span>© {BRAND.year}
        </span>
        <ProductUpdatesTrigger
          appVersion={appVersion}
          apiVersion={apiVersion}
          className="legal-corner-link"
        />
        <LegalDocLink
          type="terms"
          docVersion={termsVersion}
          className="legal-corner-link"
          onOpen={setModalType}
        />
        <LegalDocLink
          type="privacy"
          docVersion={privacyVersion}
          className="legal-corner-link"
          onOpen={setModalType}
        />
      </div>

      <LegalDocModal type={modalType} legal={legal} onClose={() => setModalType(null)} />
    </>
  );
}
