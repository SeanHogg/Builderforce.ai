'use client';

import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';

/**
 * "2 messages queued" — the receipt for turns typed while a run was still in
 * flight (see {@link useQueuedTurns}). Self-gating: renders nothing at zero, so
 * a host mounts it unconditionally beside its composer.
 *
 * Owns its own copy from the shared `brain` catalog, so every surface with a
 * queueing composer says the same sentence in the viewer's language.
 */
export function QueuedTurnsNotice({ count }: { count: number }) {
  const t = useTranslations('brain');
  if (count <= 0) return null;
  return (
    <div style={{
      fontSize: 'var(--font-size-small)',
      color: 'var(--text-muted)',
      marginTop: 4,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    }}>
      <span aria-hidden><Icon source="⏳" size="1em" /></span>
      {t('queuedCount', { count })}
    </div>
  );
}
