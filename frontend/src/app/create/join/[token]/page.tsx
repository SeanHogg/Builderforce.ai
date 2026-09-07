import JoinCanvasClient from './JoinCanvasClient';

export const runtime = 'edge';

export default async function CanvasJoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinCanvasClient token={token} />;
}
