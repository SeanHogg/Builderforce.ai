import { TemplateDetailClient } from './TemplateDetailClient';

// A dynamic segment rendered per request — next-on-pages fails the Cloudflare
// build without this, and there is no static param set to prerender: the keys
// come from the workspace's own catalogue.
export const runtime = 'edge';

/**
 * `/templates/<key>` — one template, read before it is set up.
 *
 * A server shell so the route can declare its runtime; everything below it is
 * client, because the detail view is a live read of the workspace's connection
 * state and it opens the guided setup in place.
 */
export default async function TemplateDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <TemplateDetailClient templateKey={key} />;
}
