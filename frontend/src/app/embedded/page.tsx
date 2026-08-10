import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import PageContainer from '@/components/PageContainer';
import { EmbeddedCapabilities } from '@/components/embedded/EmbeddedCapabilities';
import { pageMetadata } from '@/lib/seo';
import { routeMarketingSchema } from '@/lib/structured-data';

// Reads the locale cookie via `next-intl/server`, so it is rendered per request.
export const runtime = 'edge';

/**
 * A reference page that is also the surface it describes (PRD 21 §11.4.5).
 *
 * Signed out it is an ordinary indexable page explaining what can be embedded
 * and how to install it; signed in it opens in `ShellPanel` over a board that
 * stays running, with the same component's controls live. Nothing here branches
 * on auth — `EmbeddedCapabilities` self-gates, so both rungs are one render.
 *
 * It was reachable as neither until now: `/embedded` starts with `/embed`, and
 * the shell's framed-webview prefix matched on a bare `startsWith`, so this
 * route was classified as a cross-origin iframe — no chrome, lean provider
 * tree, invisible to crawlers. See `isFramedEmbed`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('embedded');
  return pageMetadata({
    title: t('title'),
    description: t('subtitle'),
    path: '/embedded',
    ogTitle: t('title'),
  });
}

export default async function EmbeddedPage() {
  const t = await getTranslations('embedded');
  return (
    <>
      <JsonLd data={routeMarketingSchema({ path: '/embedded', title: t('title'), description: t('subtitle') })} />
      {/* No padding override: `.page-container` owns it precisely so it can
          shrink, and this page now also renders inside `ShellPanel` — where a
          hard 40px gutter was 12% of the body at sheet width. */}
      <PageContainer width="full"><EmbeddedCapabilities /></PageContainer>
    </>
  );
}
