import { PhoneConsole } from '@/components/phone/PhoneConsole';
import { InboxClient } from './InboxClient';

export const runtime = 'edge';

/**
 * `/inbox` — messaging, whichever wire it arrives on.
 *
 * The tabs are declared in `navGroups`; this reads `?tab=` and picks the body.
 *
 * A SERVER component, unlike the `/workforce` and `/quality` shells it otherwise
 * mirrors. Those reach for `useSearchParams`, which forces `'use client'` on the
 * shell and a Suspense boundary around it; the App Router hands a server page its
 * `searchParams` directly, so the switch costs neither. The two bodies are client
 * components that bring their own data — the leaves are where interactivity
 * belongs, and a shell that is only a switch has no reason to ship to the browser.
 */
export default async function InboxPage({
  searchParams,
}: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return tab === 'phone' ? <PhoneConsole /> : <InboxClient />;
}
