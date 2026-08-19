// No 'use client' directive: this is only ever rendered by `LiveBar` and by
// `CreationCanvas`, both of which already declare the boundary, so it is inherited —
// the same reason `CanvasSessionPill` and `RemoteCursors` omit it. Declaring it again
// would only add a file to the architecture ratchet's client-component tally.
import { Icon } from '@/components/ui/Icon';
import { useTranslations } from 'next-intl';
import { useCanvasLiveRoom } from '@/lib/live/useCanvasLiveRoom';
import styles from './StartCallButton.module.css';

/**
 * The ONE control that opens a call.
 *
 * Two surfaces render it and neither decides anything: the live dock's dormant
 * strip at the bottom of the shell, and the invite panel on a logged-out board —
 * where "get someone in here" and "talk to them" are the same errand, so putting
 * the call anywhere else would mean a free user had to find it. It self-gates on
 * `useCanvasLiveRoom`, so a caller never passes a `canStart` it could not compute
 * itself, and there is one label and one gate rather than one per placement.
 *
 * Absent when there is no room to open, and absent once the call is running —
 * the dock is the control from that moment on.
 */
export function StartCallButton({ variant = 'dock' }: { variant?: 'dock' | 'panel' }) {
  const t = useTranslations('liveBar');
  const room = useCanvasLiveRoom();

  if (!room || room.live || !room.canStart) return null;

  return (
    <button
      type="button"
      className={styles.start}
      data-variant={variant}
      onClick={room.start}
      title={t('startCallTitle')}
    >
      <span aria-hidden="true"><Icon source="🎧" size="1em" /></span>{t('startCall')}
    </button>
  );
}
