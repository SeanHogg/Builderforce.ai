import { SignerConsole } from '@/components/signature/SignerConsole';

/**
 * `/sign/<token>` — where a party signs or acknowledges.
 *
 * Unauthenticated by construction: the signer is outside the workspace and has
 * no session, so the token IS the credential and the row it resolves to reports
 * the tenant rather than the caller asserting one.
 *
 * The token is a PATH segment rather than a query parameter. Both end up in
 * logs; a path segment at least does not survive a `Referer` header to whatever
 * the document body happens to link to.
 *
 * `runtime = 'edge'` because this route is not static.
 */
export const runtime = 'edge';

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignerConsole token={token} />;
}
