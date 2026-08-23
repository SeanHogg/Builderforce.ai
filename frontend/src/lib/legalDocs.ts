/**
 * The current Terms / Privacy documents — types, canonical routes, and the read.
 *
 * These documents are authored and versioned in the app (published through the
 * admin legal surface) and served by ONE public endpoint. They were previously
 * readable only inside a slide-out panel, which meant the binding instruments a
 * visitor agrees to had no address: nothing could link to them, cite a version,
 * or be handed to a reviewer. An OAuth provider verifying the app is exactly
 * such a reviewer — it asks for a Privacy Policy URL and there was none to give.
 *
 * So the route for each document lives here, beside the fetch, and every surface
 * that names a legal document — the footer strip, the sidebar rail, the
 * compliance-centre nav, the public pages themselves — resolves it through
 * {@link legalDocHref} rather than writing the path again.
 */

import { publicApiGet } from './publicApi';

/** The two documents a visitor is bound by. Also the panel's discriminator. */
export type LegalDocType = 'terms' | 'privacy';

export interface LegalDocument {
  version: string;
  title: string;
  content: string;
  publishedAt: string;
}

export interface LegalCurrent {
  terms: LegalDocument;
  privacy: LegalDocument;
}

/** Public, uncredentialed — the documents are what a visitor agrees to. */
const LEGAL_CURRENT_PATH = '/api/auth/legal/current';

/**
 * Where each document lives publicly.
 *
 * Under `/legal/` so it inherits that segment's edge runtime and compliance
 * chrome, and so the trust centre's nav is one list rather than two.
 */
const LEGAL_DOC_ROUTES: Record<LegalDocType, string> = {
  terms: '/legal/terms',
  privacy: '/legal/privacy',
};

/** The canonical public URL of a legal document. */
export function legalDocHref(type: LegalDocType): string {
  return LEGAL_DOC_ROUTES[type];
}

/** The catalog key holding a document's title. Shared so the nav, the page
 *  heading and the footer link cannot drift into three names for one document.
 *  `compact` selects the one-word form ("Terms"/"Policy") for rails too narrow
 *  for the full instrument name ("Terms of Use"/"Privacy Policy") — the link
 *  still points at the same document, just named shorter. */
export function legalDocTitleKey(
  type: LegalDocType,
  compact = false,
): 'termsTitle' | 'privacyTitle' | 'termsShortTitle' | 'privacyShortTitle' {
  if (compact) return type === 'terms' ? 'termsShortTitle' : 'privacyShortTitle';
  return type === 'terms' ? 'termsTitle' : 'privacyTitle';
}

/**
 * Read both current documents. `null` on any failure — a legal page that cannot
 * reach the API must still render its chrome and say so, rather than 500 on the
 * document someone opened specifically to read.
 *
 * Cached through {@link publicApiGet}. Ten minutes rather than the default hour:
 * a freshly published policy version should reach readers on the same visit that
 * the acceptance prompt starts citing it.
 */
export async function fetchLegalCurrent(): Promise<LegalCurrent | null> {
  const data = await publicApiGet<Partial<LegalCurrent>>(LEGAL_CURRENT_PATH, {
    revalidateSeconds: 600,
  });
  return data?.terms && data?.privacy ? (data as LegalCurrent) : null;
}
