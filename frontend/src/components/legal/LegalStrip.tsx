// No 'use client': rendered only inside `Sidebar.tsx`'s client boundary.
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useLegalDocs } from './useLegalDocs';
import LegalDocModal, { type LegalDocType } from './LegalDocModal';
import LegalDocLink from './LegalDocLink';
import ProductUpdatesTrigger from '../releaseNotes/ProductUpdatesTrigger';
import { BRAND } from '@/lib/content';

/**
 * Copyright + version + Terms/Privacy — the row itself, with nowhere it decides
 * to render.
 *
 * Lives as the last row of the sidebar rail (`Sidebar`), off the board entirely,
 * on every route including a stage route — kept as its own component so the
 * fetch, the modal state and the markup have one home even though only one
 * caller mounts it today.
 */
export function LegalStrip({ className }: { className: string }) {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const t = useTranslations('legal');
  const [modalType, setModalType] = useState<LegalDocType | null>(null);

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
