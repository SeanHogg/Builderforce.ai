import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import { routeTeaserSchema } from '@/lib/routeTeaserMetadata';

/**
 * The FAQ JSON-LD a signed-out teaser used to render, emitted by the REAL page.
 *
 * A SERVER component on purpose: structured data is only worth anything in the
 * HTML a crawler receives, and a server route entry renders it there with no
 * client bundle cost. It decides its own visibility — `null` for a route whose
 * registry row carries no FAQ — so a route entry can mount it unconditionally.
 * Async because the FAQ is catalog copy, resolved in the request's locale.
 */
export default async function RouteTeaserJsonLd({ pathname }: { pathname: string }) {
  const t = await getTranslations();
  const data = routeTeaserSchema(pathname, (key) => t(key as never));
  return data ? <JsonLd data={data} /> : null;
}
