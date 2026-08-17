import { LegalDocumentShareViewer } from '@/components/legal/LegalDocumentShareViewer';

/**
 * `/legal-documents/shared/<token>` — where an external recipient opens a
 * shared legal file.
 *
 * Unauthenticated by construction, same reasoning as `/sign/<token>`: the
 * recipient has no session, so the token IS the credential and the row it
 * resolves to reports the tenant rather than the caller asserting one.
 *
 * `runtime = 'edge'` because this route is not static.
 */
export const runtime = 'edge';

export default async function LegalDocumentSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LegalDocumentShareViewer token={token} />;
}
