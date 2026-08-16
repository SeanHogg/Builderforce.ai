'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isStageRoute } from '@/lib/workbenchPolicy';
import { useLegalDocs } from './useLegalDocs';
import LegalDocModal, { type LegalModalType } from './LegalDocModal';
import LegalDocLink from './LegalDocLink';
import ProductUpdatesTrigger from '../releaseNotes/ProductUpdatesTrigger';
import { BRAND } from '@/lib/content';

/**
 * Copyright + version + Terms/Privacy strip for the operator shell, in the
 * BOTTOM-RIGHT corner of the frame.
 *
 * It used to hang off the bottom of the sidebar, where it competed with the
 * rail's navigation for the eye at the exact edge the board wants to be widest.
 * The shell already ends in a footer band (`TeamBar`), so this is the last row
 * of `.app-frame` and sits in normal flow — chrome in the corner can never
 * cover the canvas, and no page has to reserve space for it.
 *
 * ONE line, on every viewport: the strip never wraps. What gives at narrow
 * widths is DETAIL, not rows — the stylesheet drops the brand word from the
 * copyright and the `(v…)` suffix from each document, both of which are stated
 * elsewhere on screen, rather than pushing a second line under the canvas.
 *
 * The version is a BUTTON, exactly as it is in the marketing footer: both open
 * the one app-wide Product Updates panel (`ProductUpdatesHost`), so the
 * changelog stays reachable from wherever someone happens to be. It carries the
 * legal reader modal with it and decides its own rendering.
 */
export default function LegalCorner() {
  const { appVersion, apiVersion, legal, termsVersion, privacyVersion } = useLegalDocs();
  const t = useTranslations('legal');
  const pathname = usePathname() || '';
  const [modalType, setModalType] = useState<LegalModalType | null>(null);

  /**
   * IT STANDS DOWN ON A STAGE ROUTE, and decides that itself.
   *
   * The doc above says the shell "already ends in a footer band (`TeamBar`)" and that
   * this is the last row after it. On a canvas neither is true any more: the board takes
   * the whole window and floats its chrome over itself, `TeamBar` folds into the command
   * bar, and a flow row under the board is simply the last strip of chrome eating height
   * the artefact should have.
   *
   * Nothing here is lost: the version button opens the same app-wide Product Updates
   * panel the marketing footer's does, and both documents are reachable from every other
   * route and from the marketing footer. A canvas is the one place in the product where
   * a permanent legal strip costs more than it carries.
   */
  if (isStageRoute(pathname)) return null;

  return (
    <>
      <div className="legal-corner" role="group" aria-label={t('navLabel')}>
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
