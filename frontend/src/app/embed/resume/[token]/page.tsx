import { PublicResumeView } from '@/components/resume/PublicResumeView';

export const runtime = 'edge';

export default async function EmbeddedResumePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return PublicResumeView({ token, embedded: true });
}
