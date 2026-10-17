import { useTranslations } from 'next-intl';
import { SurfaceEmptyState } from '@seanhogg/builderforce-brain-ui';
import { GuestSignupCta } from '@/components/GuestSignupCta';
import type { GuestLimitRefusal } from '@/lib/guestLimit';

/**
 * The conversion wall shown once the daily allowance is spent.
 *
 * The buttons themselves are <GuestSignupCta>, shared with the kill-switch panel
 * below and with the Creation Canvas — one block, one pair of destinations, so a
 * guest who runs out mid-sentence is offered the same way forward everywhere.
 * Only the sentence differs here, because a room's allowance was spent by
 * everyone in it together.
 */
export function GuestCapWall({
  limit, shared, refusal,
}: {
  limit: number;
  /** In a room the allowance was spent by everyone together — say so. */
  shared: boolean;
  /** The gateway's own verdict, when a refusal (not the local counter) raised this
   *  wall. A per-device cap is NOT "your ten messages", and saying so to someone
   *  who has sent two is a lie they can check. */
  refusal: GuestLimitRefusal | null;
}) {
  const t = useTranslations('guestBrain');
  const tRoom = useTranslations('guestRoom');
  const body = refusal?.reason === 'ip'
    ? t('wallBodyDevice')
    : shared || refusal?.reason === 'room'
      ? tRoom('wallBody', { count: refusal?.limit ?? limit })
      : t('wallBody', { count: refusal?.limit ?? limit });
  return (
    <GuestSignupCta prompt={{ next: '/brainstorm' }} title={t('wallTitle')} body={body} />
  );
}

/** Shown when guest chat is disabled (kill switch) or unreachable. */
export function GuestDisabledCTA({ layout }: { layout: 'page' | 'docked' }) {
  const t = useTranslations('guestBrain');
  return (
    <SurfaceEmptyState
      layout={layout}
      title={t('meetTitle')}
      hint={t('meetBody')}
      controls={<GuestSignupCta prompt={{ next: '/brainstorm' }} layout="actions" />}
    />
  );
}
