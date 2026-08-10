'use client';

/**
 * The client edge that lets a SERVER reference page name itself in the panel.
 *
 * `usePublishReferenceChrome` is a hook, so `/soc2` and `/integrations` — server
 * components that read `getTranslations` — could not call it, and their panels
 * opened with a registry title and no index rail. Declaring their sections on
 * the registry row was not the answer either: `/integrations`' sections ARE its
 * categories, which come from `SEO_INTEGRATIONS`, and the registry must not
 * restate a catalog it does not own.
 *
 * A leaf client component with serializable props is the whole fix: the server
 * page passes the SAME array it renders its anchors from, so the rail and the
 * page cannot disagree — which is a stronger guarantee than the build-time check
 * that used to assert it, because it is structural rather than asserted.
 *
 * Renders nothing. `ReferencePage` mounts it; no page should need it directly.
 */

import { usePublishReferenceChrome, type ReferenceChromeSection } from '@/lib/referenceChrome';

export function ReferenceChrome({ title, sections }: { title?: string; sections?: ReferenceChromeSection[] }) {
  usePublishReferenceChrome(title || sections?.length ? { title: title ?? '', ...(sections?.length ? { sections } : {}) } : null);
  return null;
}

export default ReferenceChrome;
