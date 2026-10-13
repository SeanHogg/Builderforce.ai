/**
 * The leads half of Admin ▸ Growth ▸ Visitors — the anonymous funnel as a table,
 * with what people actually asked for.
 *
 * A visitor who types a prompt into the landing composer IS a lead, and this is
 * the only place that funnel is visible end to end: the intent in their own
 * words, whether they came back, whether they signed up, whether they paid.
 *
 * The row is a summary — three lines of intent is enough to recognise a lead —
 * and the full text is one click away in VisitorPanel. The header stays put
 * while that list scrolls, because a sorted column whose label has scrolled off
 * is a column you have to re-derive.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { type AdminGuestSession, type AdminGuestSessionsPage } from '@/lib/adminApi';
import { GuestSessionCopyButton } from '@/components/visitors/GuestSessionCopyButton';
import { AdminError, AdminLoading, SortableTh, StatTile, useAdminFormat, useTableSort } from '@/components/admin/adminShared';

type SessionSortKey = 'visitor' | 'intent' | 'engagement' | 'lastSeen' | 'conversion';

/**
 * Extra fields the S5 list derives on the API (`GuestSessionWithIntent`).
 * `adminApi.ts` is owned by another workstream, so they are optional here:
 * a payload without them still renders; a payload with them ranks and chips.
 */
type LeadSession = AdminGuestSession & {
  score?: number;
  visitCount?: number;
  lastVisitId?: string | null;
};

function asLead(session: AdminGuestSession): LeadSession {
  return session as LeadSession;
}

function scoreOf(session: AdminGuestSession): number {
  const score = asLead(session).score;
  return typeof score === 'number' && Number.isFinite(score) ? score : 0;
}

function visitCountOf(session: AdminGuestSession): number {
  const n = asLead(session).visitCount;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/** Where a visitor got to, as a rank — so "Conversion" sorts along the funnel
 *  rather than alphabetically by badge text. */
function outcomeRank(session: AdminGuestSession): number {
  return session.isPaid ? 2 : session.converted ? 1 : 0;
}

/** An unparseable stamp sorts as the epoch rather than as NaN, which would make
 *  the comparator inconsistent and leave the whole column in an arbitrary order. */
function stampValue(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

const SESSION_COMPARATORS: Record<SessionSortKey, (a: AdminGuestSession, b: AdminGuestSession) => number> = {
  visitor: (a, b) => a.visitorId.localeCompare(b.visitorId),
  intent: (a, b) => (a.promptCount - b.promptCount) || (stampValue(a.lastSeenAt) - stampValue(b.lastSeenAt)),
  engagement: (a, b) =>
    (scoreOf(a) - scoreOf(b))
    || (visitCountOf(a) - visitCountOf(b))
    || (a.guestChatCount - b.guestChatCount)
    || (a.guestChatTokens - b.guestChatTokens)
    || (stampValue(a.lastSeenAt) - stampValue(b.lastSeenAt)),
  lastSeen: (a, b) => stampValue(a.lastSeenAt) - stampValue(b.lastSeenAt),
  conversion: (a, b) => (outcomeRank(a) - outcomeRank(b)) || (stampValue(a.lastSeenAt) - stampValue(b.lastSeenAt)),
};

const INITIAL_SORT = { key: 'lastSeen', direction: 'desc' } as const;

export function LeadsView({
  data,
  loading,
  error,
  onOpenLead,
}: {
  data: AdminGuestSessionsPage | null;
  loading: boolean;
  error: string;
  onOpenLead: (session: AdminGuestSession) => void;
}) {
  const { fmtDateTime, fmtNum } = useAdminFormat();
  const t = useTranslations('admin.sessions');
  const tCommon = useTranslations('common');
  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const { sort, toggle, sorted } = useTableSort<SessionSortKey, AdminGuestSession>(
    sessions,
    SESSION_COMPARATORS,
    INITIAL_SORT,
  );
  const summary = data?.summary;

  return (
    <section aria-labelledby="insights-leads-heading" style={{ marginTop: 28 }}>
      <h2 id="insights-leads-heading" style={{ fontSize: 'var(--font-size-body)', margin: '0 0 12px' }}>
        {t('title')}
      </h2>
      {loading && <AdminLoading />}
      <AdminError message={error} />

      {summary && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          <StatTile label={t('statSessions')} value={fmtNum(summary.sessions)} />
          <StatTile
            label={t('statStatedIntent')}
            value={fmtNum(summary.sessionsWithPrompt)}
            hint={t('statPromptsHint', { count: summary.prompts })}
          />
          <StatTile label={t('statRegistered')} value={fmtNum(summary.registered)} />
          <StatTile label={t('statPaid')} value={fmtNum(summary.paid)} />
          <StatTile
            label={t('statConversion')}
            value={`${summary.conversionPct}%`}
            hint={t('statConversionHint')}
          />
        </div>
      )}

      {sessions.length === 0 && !loading ? (
        <p className="text-muted" style={{ padding: 24 }}>{t('empty')}</p>
      ) : sessions.length > 0 ? (
        <div className="table-wrap table-wrap--sticky">
          <table className="data-table">
            <thead>
              <tr>
                <SortableTh columnKey="visitor" label={t('visitor')} sort={sort} onSort={toggle} sortLabel={t('sortBy', { column: t('visitor') })} />
                <SortableTh columnKey="intent" label={t('intent')} sort={sort} onSort={toggle} sortLabel={t('sortByIntent')} />
                <SortableTh columnKey="engagement" label={t('engagement')} sort={sort} onSort={toggle} sortLabel={t('sortBy', { column: t('engagement') })} />
                <SortableTh columnKey="lastSeen" label={t('lastSeen')} sort={sort} onSort={toggle} sortLabel={t('sortBy', { column: t('lastSeen') })} />
                <SortableTh columnKey="conversion" label={t('conversion')} sort={sort} onSort={toggle} sortLabel={t('sortBy', { column: t('conversion') })} />
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((session) => (
                <tr key={session.id}>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-small)', padding: 0, textAlign: 'left' }}
                      onClick={() => onOpenLead(session)}
                    >
                      {session.visitorId}
                    </button>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>{session.landingPath ?? '—'}</div>
                    {asLead(session).lastVisitId && (
                      <div
                        className="text-muted"
                        style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-small)' }}
                        title={asLead(session).lastVisitId ?? undefined}
                      >
                        {asLead(session).lastVisitId}
                      </div>
                    )}
                  </td>
                  <td style={{ maxWidth: 380, minWidth: 220 }}>
                    {session.firstPrompt ? (
                      <>
                        <div className="text-clamp" style={{ fontSize: 'var(--font-size-small)' }} title={session.firstPrompt}>
                          {session.firstPrompt}
                        </div>
                        <div className="text-muted" style={{ fontSize: 'var(--font-size-small)', marginTop: 2 }}>
                          {t('promptMeta', { count: session.promptCount, surface: session.lastSurface ?? '—' })}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>{t('noPrompt')}</span>
                    )}
                  </td>
                  <td>
                    <div>
                      <span className="badge badge-neutral" title={t('engagement')}>{fmtNum(scoreOf(session))}</span>
                    </div>
                    <div>{t('brainMessages', { count: session.guestChatCount })}</div>
                    <div className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>
                      {t('tokensAndTools', { tokens: fmtNum(session.guestChatTokens), tools: fmtNum(session.toolRuns) })}
                    </div>
                  </td>
                  <td className="text-muted">
                    {fmtDateTime(session.lastSeenAt)}
                    <div style={{ fontSize: 'var(--font-size-small)' }}>{t('firstSeenAt', { at: fmtDateTime(session.firstSeenAt) })}</div>
                  </td>
                  <td>
                    {session.isPaid ? (
                      <span className="badge badge-success">{t('paid')}</span>
                    ) : session.converted ? (
                      <span className="badge badge-neutral">{t('registered')}</span>
                    ) : (
                      <span className="badge badge-neutral">{t('guest')}</span>
                    )}
                    {session.convertedEmail && (
                      <div className="text-muted" style={{ fontSize: 'var(--font-size-small)', marginTop: 4 }}>{session.convertedEmail}</div>
                    )}
                    {session.converted && session.convertedAt && (
                      <div className="text-muted" style={{ fontSize: 'var(--font-size-small)', marginTop: 4 }}>
                        {t('metricSignedUpAt')} {fmtDateTime(session.convertedAt)}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => onOpenLead(session)}
                        aria-label={t('viewAria', { visitor: session.visitorId })}
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {tCommon('view')}
                      </button>
                      <GuestSessionCopyButton session={session} compact />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
