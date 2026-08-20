'use client';

/**
 * ONE timeline component, instead of a per-subsystem feed (PRD 20 §7.1).
 *
 * Fed by `activity_log` through either `/api/objects/:id/activity` or
 * `/api/<domain>/activity`, so a seat's landing surface and an object's detail
 * panel render the same rows through the same component. That is the whole
 * argument for doing the schema first: building this against thirty per-feature
 * event shapes would have meant building it thirty times.
 *
 * DECIDES ITS OWN VISIBILITY. No `canX` boolean is drilled in — with nothing to
 * show it renders its own empty state, and with no source it returns null. A
 * consumer drops it in unconditionally.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  getDomainActivity,
  getObjectActivity,
  type ActivityEntry,
  type Domain,
} from '@/lib/kernel/kernelApi';
import { useFormat } from "@/i18n/useFormat";

/** Actor kind → the token that colours its glyph. One map, so the timeline, the
 *  roster and the board agree on what "an agent did this" looks like. */
const ACTOR_TOKEN: Record<string, string> = {
  human: 'var(--accent)',
  hire: 'var(--cyan-bright, var(--accent))',
  cloud_agent: 'var(--badge-unread, var(--accent))',
  host_agent: 'var(--badge-unread, var(--accent))',
  system: 'var(--text-muted)',
};

function relativeTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800],
    ['day', 86_400], ['hour', 3_600], ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(seconds, 'second');
}

export function ObjectTimeline({
  objectId,
  domain,
  limit = 30,
  locale = 'en',
}: {
  /** Render one object's trail. Mutually exclusive with `domain`. */
  objectId?: string;
  /** Render one seat's trail. */
  domain?: Domain;
  limit?: number;
  locale?: string;
}) {
  const fmt = useFormat();
  const t = useTranslations('kernel.timeline');
  const [rows, setRows] = useState<ActivityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!objectId && !domain) return;
    try {
      const data = objectId
        ? await getObjectActivity(objectId, limit)
        : await getDomainActivity(domain as Domain, limit);
      setRows(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [objectId, domain, limit]);

  useEffect(() => { void load(); }, [load]);

  // No source is not an error state — it is "this component was mounted with
  // nothing to render", and returning null is how a shared component decides its
  // own visibility rather than making every consumer compute it.
  if (!objectId && !domain) return null;

  if (failed) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('failed')}</p>;
  }
  if (rows === null) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('loading')}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('empty')}</p>;
  }

  return (
    <ol className="flex flex-col gap-0 m-0 p-0 list-none">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex gap-3 py-2.5 items-start"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <span
            aria-hidden
            className="mt-1.5 shrink-0 rounded-full"
            style={{
              width: 7,
              height: 7,
              background: ACTOR_TOKEN[row.actorType] ?? 'var(--text-muted)',
            }}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm m-0 break-words" style={{ color: 'var(--text-primary)' }}>
              <span className="font-medium">{row.actorName ?? t('someone')}</span>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>{row.verb}</span>
              {(row.objectTitle ?? row.targetLabel) ? (
                <>
                  {' '}
                  <span style={{ color: 'var(--text-primary)' }}>
                    {row.objectTitle ?? row.targetLabel}
                  </span>
                </>
              ) : null}
            </p>
            {row.summary ? (
              <p className="text-xs m-0 mt-0.5 break-words" style={{ color: 'var(--text-muted)' }}>
                {row.summary}
              </p>
            ) : null}
          </div>
          <time
            dateTime={row.occurredAt}
            className="text-xs shrink-0 tabular-nums"
            style={{ color: 'var(--text-muted)' }}
            title={fmt.dateTime(row.occurredAt)}
          >
            {relativeTime(row.occurredAt, locale)}
          </time>
        </li>
      ))}
    </ol>
  );
}
