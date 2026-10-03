import { notFound } from 'next/navigation';
import { StudioProject } from '@/components/studio/StudioProject';

export const runtime = 'edge';

export default async function StudioProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) notFound();
  return <StudioProject projectId={projectId} />;
}
