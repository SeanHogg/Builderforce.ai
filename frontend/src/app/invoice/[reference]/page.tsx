import { PublicInvoice } from '@/components/invoice/PublicInvoice';

/**
 * `/invoice/<reference>?t=<token>` — the customer's own copy.
 *
 * Unauthenticated by construction, exactly like `/sign/<token>`: the reader is
 * outside the workspace and has no session, so the token IS the credential and the
 * row it resolves to reports the tenant rather than the caller asserting one.
 *
 * The reference is a PATH segment and the token a query parameter, which is the
 * reverse of the signer route and deliberate: the processor's hosted checkout
 * redirects back to this URL with its own parameter appended, and a token in the
 * path would make that return address a second thing to reassemble. The reference
 * on its own authorises nothing.
 *
 * `runtime = 'edge'` because this route is not static.
 */
export const runtime = 'edge';

export default async function InvoicePage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  return <PublicInvoice reference={decodeURIComponent(reference)} />;
}
