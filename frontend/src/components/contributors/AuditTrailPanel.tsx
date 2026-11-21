import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { activityApi, type ActivityActorType, type ActivityLogEvent } from '@/lib/builderforceApi';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { ACTOR_ORDER, ACTOR_STYLE, auditSearch, useActorLabel, useAuditDescriptor } from './auditTrailCollection';

/**
 * Unified activity / audit trail — the tenant-wide, append-only stream of "who did
 * what, to what, when" across the whole workforce: team members, external talent /
 * hires, and AI agents alike. Reads /api/activity/log (MANAGER+, cached). Self-
 * contained: owns its own fetch and actor filter. The events render through the
 * ONE Collection (PRD 47), which pages what is loaded; the endpoint is keyset-
 * paged (no total), so "load older" extends the loaded window from the cursor.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

const PAGE = 40;

export function AuditTrailPanel() {
  const errorMessage = useErrorMessage();
  const t = useTranslations('audit');
  const actorLabel = useActorLabel();
  const descriptor = useAuditDescriptor();
  const [events, setEvents] = useState<ActivityLogEvent[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actorType, setActorType] = useState<ActivityActorType | 'all'>('all');

  const loadOlder = useCallback(() => {
    setLoadingMore(true);
    activityApi.log({ actorType: actorType === 'all' ? undefined : actorType, beforeId: cursor ?? undefined, limit: PAGE })
      .then((page) => { setEvents((prev) => [...prev, ...page.events]); setCursor(page.nextCursor); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoadingMore(false));
  }, [actorType, cursor, errorMessage]);

  // Reset + reload whenever the actor filter changes.
  useEffect(() => {
    setLoading(true); setError(null);
    activityApi.log({ actorType: actorType === 'all' ? undefined : actorType, limit: PAGE })
      .then((page) => { setEvents(page.events); setCursor(page.nextCursor); })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [actorType, errorMessage]);

  const filters: Array<ActivityActorType | 'all'> = ['all', ...ACTOR_ORDER];

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-strong)' }}>{t('title')}</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>{t('subtitle')}</p>
      </div>

      {error && (
        <div style={{ ...cardStyle, borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 12 }}>{error}</div>
      )}

      {/* Keep the collection (and its filter slot) mounted while a filter change reloads. */}
      {loading && events.length === 0 ? (
        <div style={{ color: 'var(--muted)', fontSize: 14, padding: 8 }}>{t('loading')}</div>
      ) : (
        <LocalCollection descriptor={descriptor} rows={events} searchText={auditSearch}>
          <div role="group" aria-label={t('filterLabel')} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {filters.map((f) => {
              const active = actorType === f;
              const accent = f === 'all' ? 'var(--accent)' : ACTOR_STYLE[f].color;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setActorType(f)}
                  aria-pressed={active}
                  style={{
                    fontSize: 12, padding: '4px 10px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                    border: `1px solid ${active ? accent : 'var(--border-subtle)'}`,
                    background: active ? accent : 'var(--bg-base)',
                    color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {f === 'all' ? t('filter.all') : actorLabel(f)}
                </button>
              );
            })}
          </div>
        </LocalCollection>
      )}

      {/* Keyset paging: the endpoint has no total, so older events extend the loaded window. */}
      {!loading && !error && cursor != null && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <button
            type="button"
            onClick={loadOlder}
            disabled={loadingMore}
            style={{
              fontSize: 13, padding: '8px 16px', borderRadius: 'var(--radius-md)',
              cursor: loadingMore ? 'default' : 'pointer',
              background: 'var(--bg-hover)',
              color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? t('loading') : t('loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
