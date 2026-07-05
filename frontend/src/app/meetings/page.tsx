import { redirect } from 'next/navigation';

export const runtime = 'edge';

/**
 * Meetings moved to a tab of Talent / Workforce (`/workforce?tab=meetings`).
 * This route only survives for old bookmarks and in-flight calendar OAuth returns
 * — redirect through to the tab, carrying any `?calendar=`/`?join=` params so the
 * connect/deep-link cleanup still fires there.
 */
export default function MeetingsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams({ tab: 'meetings' });
  for (const key of ['calendar', 'join'] as const) {
    const v = searchParams?.[key];
    if (typeof v === 'string') params.set(key, v);
  }
  redirect(`/workforce?${params.toString()}`);
}
