'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import CreationSessionClient from '@/components/canvas/CreationSessionClient';
import { useBoardSyncOutcome } from '@/components/canvas/useBoardSyncOutcome';
import { useAuth } from '@/lib/AuthContext';
import { DEVICE_BOARD_PARAM, isBrowserOnline, isDeviceBoardId, studioSessionPath } from '@/lib/studio/studioHost';

/** The board named by `?board=`, opened from this device's replica. */
function DeviceBoard({ boardId }: { boardId: string }) {
  const router = useRouter();
  const { isAuthenticated, hasTenant } = useAuth();
  // Once the server has accepted the board it has a server page: while online, the address moves to it
  // (never before, which would be a 404). A guest's board is never accepted and stays here.
  useBoardSyncOutcome(boardId, isAuthenticated && hasTenant, () => {
    if (isBrowserOnline()) router.replace(studioSessionPath(boardId));
  });
  return <CreationSessionClient sessionId={boardId} lens="studio" />;
}

export default function DeviceBoardClient() {
  const t = useTranslations('studio.deviceBoard');
  const boardId = useSearchParams().get(DEVICE_BOARD_PARAM);
  if (!isDeviceBoardId(boardId)) return <p role="alert" style={{ padding: 24 }}>{t('notFound')}</p>;
  return <DeviceBoard boardId={boardId.toLowerCase()} />;
}
