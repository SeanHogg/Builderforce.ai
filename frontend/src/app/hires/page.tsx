'use client';

/**
 * /hires is retired — employer-side management of hired freelancers now lives as the
 * Talent tab of Workforce (Talent / Workforce). Keep this route as a redirect so old
 * links and bookmarks land on the relocated surface.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HiresRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/workforce?tab=talent'); }, [router]);
  return null;
}
