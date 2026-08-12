import { PublicResumeView } from '@/components/resume/PublicResumeView';

export const runtime = 'edge';

export default async function PublicResumePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return PublicResumeView({ token });
}
