import type { Metadata } from 'next';
import { ProspectDealView } from '@/components/sell/ProspectDealView';

export const runtime = 'edge';

/**
 * The buyer's door. One dynamic segment, no auth, no shell.
 *
 * `noindex` is not a nicety: the URL IS the credential, and a search engine that indexes
 * one has published a priced offer to the internet. `robots.ts` cannot cover this — it
 * excludes paths, and every one of these is a different path — so the refusal is stated on
 * the page itself.
 *
 * The title is deliberately generic. A share's real title is the seller's and the buyer's
 * business; putting it in a browser tab (and in the link preview of whoever forwards it)
 * leaks who is being sold to.
 */
export const metadata: Metadata = {
  title: 'Shared with you',
  robots: { index: false, follow: false, nocache: true },
};

export default async function ProspectDealPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ProspectDealView token={token} />;
}
