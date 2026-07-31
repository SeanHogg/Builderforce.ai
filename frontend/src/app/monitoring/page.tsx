import { redirect } from 'next/navigation';

export const runtime = 'edge';

/**
 * Monitoring was consolidated into the Reliability destination — it is now the
 * "Monitors" and "Reporting" tabs of the incidents page. This route only survives
 * for old bookmarks / deep links: bare /monitoring → the Monitors board canvas,
 * and the retired ?tab=reporting → the Reporting tab.
 */
export default async function MonitoringPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const tab = resolved?.tab === 'reporting' ? 'reporting' : 'monitors';
  redirect(`/incidents?tab=${tab}`);
}
