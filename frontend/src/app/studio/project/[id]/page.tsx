import { notFound } from 'next/navigation';
import { StudioProject } from '@/components/studio/StudioProject';
import { studioChatLinkFrom, studioPublishLinkFrom } from '@/lib/studio/studioDeepLink';

export const runtime = 'edge';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StudioProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<SearchParams> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId) || projectId <= 0) notFound();
  const query = (await searchParams) ?? {};
  const queryParams = { get: (name: string) => { const value = query[name]; return Array.isArray(value) ? value[0] ?? null : value ?? null; } };
  const link = studioChatLinkFrom(queryParams);
  return <StudioProject projectId={projectId} initialChatId={link.chatId} initialTicket={link.ticket} openPublish={studioPublishLinkFrom(queryParams).openPublish} />;
}
