import JsonLd from '@/components/JsonLd';
import { routeTeaserSchema } from '@/lib/routeTeaserMetadata';

/**
 * The FAQ JSON-LD a signed-out teaser used to render, emitted by the REAL page.
 *
 * A SERVER component on purpose: structured data is only worth anything in the
 * HTML a crawler receives, and a server route entry renders it there with no
 * client bundle cost. It decides its own visibility — `null` for a route whose
 * registry row carries no FAQ — so a route entry can mount it unconditionally.
 */
export default function RouteTeaserJsonLd({ pathname }: { pathname: string }) {
  const data = routeTeaserSchema(pathname);
  return data ? <JsonLd data={data} /> : null;
}
