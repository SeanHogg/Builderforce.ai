import InvitationAcceptClient from './InvitationAcceptClient';

export const runtime = 'edge';

export default async function CreationInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitationAcceptClient token={token} />;
}
