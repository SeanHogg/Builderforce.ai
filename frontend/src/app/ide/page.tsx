'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /ide → /ide/dashboard.
 *
 * The IDE launcher now lives at /ide/dashboard (project-type chooser + existing
 * projects grouped by IDE type). This route is kept only as a redirect so old
 * links and the previous sidebar target still land in the right place.
 */
export default function IDEEntryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/ide/dashboard');
  }, [router]);
  return null;
}
