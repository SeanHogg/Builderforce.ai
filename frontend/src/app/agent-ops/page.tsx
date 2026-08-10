import { redirect } from 'next/navigation';

export const runtime = 'edge';

/** Agent Ops now lives inside Workforce; preserve old bookmarks and deep links. */
export default async function AgentOpsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const requested = resolved?.tab;
  const tab = requested === 'memory' || requested === 'rehearsal' ? requested : 'coordination';
  redirect(`/workforce?tab=${tab}`);
}
