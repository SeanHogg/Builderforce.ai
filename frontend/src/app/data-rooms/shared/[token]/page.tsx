import { DataRoomShareViewer } from '@/components/investor/DataRoomShareViewer';

/**
 * `/data-rooms/shared/<token>` — where a firm opens a data room it was sent.
 *
 * Unauthenticated by construction, same reasoning as `/sign/<token>` and
 * `/legal-documents/shared/<token>`: the recipient has no session, so the token IS
 * the credential and the row it resolves to reports the tenant rather than the
 * caller asserting one. Every rule the link carries — the NDA gate, the room's
 * expiry as well as the link's, and the watermark — is enforced server-side in
 * `dataRoomSharing.ts`, so this page can only ever show what the token actually
 * opens.
 *
 * `runtime = 'edge'` because this route is not static.
 */
export const runtime = 'edge';

export default async function DataRoomSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DataRoomShareViewer token={token} />;
}
