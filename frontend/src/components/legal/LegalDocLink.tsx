import { useTranslations } from 'next-intl';
import type { LegalModalType } from './LegalDocModal';

/**
 * ONE legal-document link — the document's title AND its published version —
 * for every strip that opens the reader (the operator shell's `LegalCorner`
 * and the marketing/auth `AppFooter`).
 *
 * It was written twice, which is two places for the `(v2.1.0)` suffix to be
 * formatted, translated from two different namespaces, and — the reason this
 * exists — two places to teach that the suffix is the FIRST thing to drop when
 * the strip has to stay on one line. The suffix now carries its own class
 * (`legal-doc-version`) so a host stylesheet can hide it at narrow widths
 * without either host having to know about the other.
 *
 * `className` is the host's own link class: the two strips are styled by their
 * own stylesheets, but everything the link is ABOUT belongs to the link.
 *
 * No `'use client'`, deliberately — same reasoning as `ProductUpdatesTrigger`:
 * both importers already declare the boundary, so the directive would buy them
 * nothing and cost the architecture ratchet a point.
 */
export default function LegalDocLink({
  type,
  docVersion,
  className,
  onOpen,
}: {
  type: LegalModalType;
  /** Published version of the document, undefined until the docs load. */
  docVersion?: string;
  className: string;
  onOpen: (type: LegalModalType) => void;
}) {
  const t = useTranslations('legal');

  return (
    <button type="button" className={className} onClick={() => onOpen(type)}>
      {t(type === 'terms' ? 'termsTitle' : 'privacyTitle')}
      {docVersion ? <span className="legal-doc-version"> (v{docVersion})</span> : null}
    </button>
  );
}
