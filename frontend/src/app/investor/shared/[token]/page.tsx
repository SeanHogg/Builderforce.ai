import { InvestorGrantView } from '@/components/investor/InvestorGrantView';

/**
 * `/investor/shared/<token>` — where a fund opens a COMPANY it was invited to (IN-2).
 *
 * Unauthenticated by construction, the same reasoning as `/sign/<token>`,
 * `/data-rooms/shared/<token>` and `/legal-documents/shared/<token>`: the
 * recipient has no session, so the token IS the credential and the row it
 * resolves to reports the tenant rather than the caller asserting one.
 * `shellRouting` lists this sub-tree under `NO_CHROME_PREFIXES`, so a fund never
 * gets the operator shell of a workspace it is not in — while `/investor` above
 * it stays the founder's destination.
 *
 * Every rule the grant carries — the one NDA, the company clock and each room's
 * own, the watermark — is enforced server-side in `companyInvestorAccess.ts` and,
 * under it, in the same `dataRoomSharing.ts` resolve a room link flows through.
 * So this page can only ever show what the token actually opens.
 *
 * `runtime = 'edge'` because this route is not static.
 */
export const runtime = 'edge';

export default async function InvestorGrantPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvestorGrantView token={token} />;
}
