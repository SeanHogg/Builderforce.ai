import type { Metadata } from 'next';
import { Suspense } from 'react';
import DeviceBoardClient from './DeviceBoardClient';

export const runtime = 'edge';

/** Someone's own board — never an indexable page. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The device shell: opens the board named by `?board=<id>` from this device's replica. It renders the
 * same board page as `/studio/<id>` and carries no per-board data, so the service worker precaches ONE copy
 * (in the person's locale) and serves it for every board when there is no network
 * (`public/sw.js`, `lib/studio/studioHost.ts`). It is a static segment, so it wins over `[sessionId]`.
 */
export default function StudioDeviceBoardPage() {
  return (
    <Suspense fallback={null}>
      <DeviceBoardClient />
    </Suspense>
  );
}
