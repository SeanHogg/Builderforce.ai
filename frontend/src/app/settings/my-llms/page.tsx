import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import { MyLlmsContent } from '@/components/settings/MyLlmsContent';

export const runtime = 'edge';

/**
 * SERVER route entry. The interactive part is the client component below;
 * this module only names it, so a `'use client'` here put the route's own
 * module — and everything it statically imports — into the client bundle for
 * nothing. Removing the directive changes no behaviour: a server component
 * may render a client child, and the child keeps its own directive.
 */
/**
 * The signed-out teaser's head, decided on the SERVER.
 *
 * Every authenticated route renders a marketing teaser to a logged-out visitor,
 * and that teaser used to set its title, description and `noindex` from a
 * `useEffect` — so the HTML a crawler or a link preview actually receives
 * carried the root layout's generic, INDEXABLE head. One shared body
 * (`routeTeaserMetadata`) so the registries are read once.
 */
export async function generateMetadata() {
  return routeTeaserMetadata('/settings/my-llms');
}

export default function MyLlmsPage() {
  return <MyLlmsContent />;
}
