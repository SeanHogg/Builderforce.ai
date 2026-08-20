import { routeTeaserMetadata } from '@/lib/routeTeaserMetadata';
import { LensPage } from '@/components/insights/LensShell';
import { ChatModeLens } from '@/components/insights/ChatModeLens';

/**
 * `/insights/chat-modes` — "Conversations vs Executions": how much of what people
 * start here is a question versus work handed over, how much of that work actually
 * got dispatched to an agent, and what each mode costs.
 *
 * The lens itself is the client component; this entry is a
 * server module, so the route prerenders statically and needs no `runtime`
 * export — the data comes from the API at request time.
 *
 * SERVER route entry. The interactive part is the client component below;
 * this module only names it, so a `'use client'` here put the route's own
 * module — and everything it statically imports — into the client bundle for
 * nothing. Removing the directive changes no behaviour: a server component
 * may render a client child, and the child keeps its own directive.
 */
/**
 * The head is decided per request (the teaser copy is localized, and the locale
 * lives in a cookie), so the route is dynamic and next-on-pages requires the
 * Edge Runtime. `check-edge-runtime.mjs` enforces the pairing.
 */
export const runtime = 'edge';

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
  return routeTeaserMetadata('/insights/chat-modes');
}

export default function ChatModeInsightsPage() {
  return (
    <LensPage capability="insights.llmUsage" titleKey="chatModes.title" subtitleKey="chatModes.subtitle">
      <ChatModeLens />
    </LensPage>
  );
}
