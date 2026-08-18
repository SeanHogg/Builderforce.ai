import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { legalDocHref, legalDocTitleKey, type LegalDocType } from '@/lib/legalDocs';

/**
 * ONE legal-document link — the document's title AND its published version —
 * for every strip that opens the reader (the operator shell's `LegalStrip`
 * and the marketing/auth `AppFooter`).
 *
 * It was written twice, which is two places for the `(v2.1.0)` suffix to be
 * formatted, translated from two different namespaces, and — the reason this
 * exists — two places to teach that the suffix is the FIRST thing to drop when
 * the strip has to stay on one line. The suffix now carries its own class
 * (`legal-doc-version`) so a host stylesheet can hide it at narrow widths
 * without either host having to know about the other.
 *
 * It is an ANCHOR, not a button, and that is load-bearing. In-app a plain click
 * still opens the reader panel — that is the better reading experience and the
 * hosts' whole reason for existing. But a legal instrument also has to be
 * addressable: linkable, openable in a new tab, followable by a crawler, and
 * quotable to an OAuth provider's verification reviewer, who asks for a Privacy
 * Policy URL and will not accept "it is behind a button". So the href is real
 * and only an UNMODIFIED primary click is intercepted; ⌘/ctrl/shift-click and
 * middle-click navigate to the page like any other link.
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
  type: LegalDocType;
  /** Published version of the document, undefined until the docs load. */
  docVersion?: string;
  className: string;
  onOpen: (type: LegalDocType) => void;
}) {
  const t = useTranslations('legal');

  return (
    <Link
      href={legalDocHref(type)}
      className={className}
      onClick={(event) => {
        // Let the browser own every click that means "somewhere else, please".
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        onOpen(type);
      }}
    >
      {t(legalDocTitleKey(type))}
      {docVersion ? <span className="legal-doc-version"> (v{docVersion})</span> : null}
    </Link>
  );
}
