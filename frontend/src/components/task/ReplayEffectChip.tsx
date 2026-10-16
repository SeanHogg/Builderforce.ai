/**
 * One line on a ticket raised from a replay moment (PRD 33 §5.3.4): did the fix
 * move the metric on that route? Read from `replayApi.ticketEffect` (computed on
 * read from the route rollups); renders nothing for any other ticket, and nothing
 * when the read fails — a ticket view must never break on a measurement.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayTicketEffectDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useFormat } from '@/i18n/useFormat';

/** A lower rate is better for frustration and errors; a higher one for conversions. */
const LOWER_IS_BETTER: Readonly<Record<ReplayTicketEffectDto['metric'], boolean>> = {
  frustrated: true,
  errors: true,
  conversions: false,
};

/** `siteId` is the replay moment's site: it scopes the read, so a proof site passes the gate without an Insights install. */
export function ReplayEffectChip({ taskId, siteId }: { taskId: number; siteId: string }) {
  const t = useTranslations('replay.ticket.effect');
  const fmt = useFormat();
  // Keyed by the read it answers, so a stale effect from the previous ticket never shows.
  const readKey = `${taskId}:${siteId}`;
  const [answer, setAnswer] = useState<{ key: string; effect: ReplayTicketEffectDto | null } | null>(null);

  useEffect(() => {
    let live = true;
    replayApi.ticketEffect(taskId, siteId)
      .then((found) => { if (live) setAnswer({ key: readKey, effect: found }); })
      .catch(() => { if (live) setAnswer({ key: readKey, effect: null }); });
    return () => { live = false; };
  }, [taskId, siteId, readKey]);

  const effect = answer?.key === readKey ? answer.effect : null;
  if (!effect) return null;
  const pct = (n: number | null) => (n === null ? '—' : fmt.number(n, { style: 'percent', maximumFractionDigits: 1 }));
  const metric = t(`metric.${effect.metric}`);

  if (effect.status === 'waiting' || effect.delta === null || !effect.after) {
    return (
      <p role="status" data-testid="replay-effect" data-effect="waiting" style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {t('waiting', { metric, route: effect.route, visits: fmt.number(effect.minVisits) })}
      </p>
    );
  }
  const better = LOWER_IS_BETTER[effect.metric] ? effect.delta < 0 : effect.delta > 0;
  const tone = effect.delta === 0 ? 'var(--text-secondary)' : better ? 'var(--success)' : 'var(--error)';
  return (
    <p role="status" data-testid="replay-effect" data-effect={better ? 'better' : 'worse'} style={{ margin: 0, fontSize: 'var(--font-size-small)', color: tone }}>
      {t('measured', { metric, route: effect.route, before: pct(effect.before.rate), after: pct(effect.after.rate), visits: fmt.number(effect.after.sessions) })}
    </p>
  );
}
