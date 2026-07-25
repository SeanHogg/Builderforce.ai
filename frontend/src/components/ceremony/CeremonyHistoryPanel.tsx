'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ViewToggle } from '@/components/ViewToggle';
import {
  ceremonySessionsApi,
  type CeremonyKind,
  type CeremonySession,
  type CeremonyParticipant,
  type CeremonyJournalEvent,
} from '@/lib/builderforceApi';

/**
 * CeremonyHistoryPanel — the ceremonies that have ALREADY run.
 *
 * The gap this fills: sessions were written to the database and then unreadable. The
 * live view only ever showed the ACTIVE session and the tenant rollup only showed
 * aggregates, so "when did we last run a standup, who was there, who wasn't, and what
 * did it change?" had no answer anywhere in the product — which also meant the manager
 * conducting a ceremony unattended would have done so unobservably.
 *
 * The LIST renders purely from the denormalised counters on each session row, so a page
 * is one request; opening a row fetches that session's roster (with attendance verdicts)
 * and its journal — the `activity_log` events targeting it, i.e. the same audit store
 * every other subsystem writes to.
 *
 * Absence is presented as a fact, never as a fault: a no-show is a neutral chip, and a
 * reassignment always shows its reason (absent AND idle for N hours) so the record
 * explains itself without anyone having to know the policy.
 */

const CHIP: React.CSSProperties = {
  padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
  border: '1px solid var(--border-subtle)', whiteSpace: 'nowrap',
};

function outcomeTone(session: CeremonySession): { bg: string; fg: string } {
  if (session.status === 'abandoned') return { bg: 'var(--bg-deep)', fg: 'var(--text-muted)' };
  if (session.closeReason === 'unattended') return { bg: 'var(--bg-elevated)', fg: 'var(--text-secondary)' };
  return { bg: 'var(--bg-elevated)', fg: 'var(--text-primary)' };
}

/** Whole minutes between two ISO stamps, or null when the session never ended. */
function durationMinutes(session: CeremonySession): number | null {
  if (!session.endedAt) return null;
  return Math.max(0, Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60_000));
}

function AttendanceRow({ p }: { p: CeremonyParticipant }) {
  const t = useTranslations('ceremonyHistory');
  const isHuman = p.memberKind === 'human';
  const verdict = p.attendance ?? 'unknown';
  const tone = verdict === 'present'
    ? { bg: 'var(--bg-elevated)', fg: 'var(--text-primary)' }
    : { bg: 'transparent', fg: 'var(--text-muted)' };
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 10, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid var(--border-subtle)',
    }}>
      <div style={{ minWidth: 0, flex: '1 1 160px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
          {p.memberName}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {isHuman ? t('seatHuman') : t('seatAgent')}
          {p.required === false && ` · ${t('seatAdHoc')}`}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {p.durationMs > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {t('spoke', { seconds: Math.round(p.durationMs / 1000) })}
          </span>
        )}
        <span style={{ ...CHIP, background: tone.bg, color: tone.fg }}>{t(`attendance.${verdict}`)}</span>
      </div>
    </div>
  );
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const t = useTranslations('ceremonyHistory');
  const format = useFormatter();
  const [participants, setParticipants] = useState<CeremonyParticipant[]>([]);
  const [journal, setJournal] = useState<CeremonyJournalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ceremonySessionsApi.detail(sessionId)
      .then((d) => {
        if (cancelled) return;
        setParticipants([...(d.participants ?? [])].sort((a, b) => a.turnOrder - b.turnOrder));
        setJournal(d.journal ?? []);
        setError(null);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : t('errorLoad')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, t]);

  if (loading) return <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>;
  if (error) return <div style={{ padding: 16, fontSize: 13, color: 'var(--error-text)' }}>{error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 16 }}>
      <section>
        <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', margin: '0 0 4px' }}>
          {t('whoWasHere')}
        </h3>
        {participants.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noParticipants')}</div>
          : participants.map((p) => <AttendanceRow key={p.id} p={p} />)}
      </section>

      <section>
        <h3 style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', margin: '0 0 4px' }}>
          {t('whatHappened')}
        </h3>
        {journal.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noJournal')}</div>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {journal.map((e) => (
              <li key={e.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                  {e.summary ?? e.verb}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {format.dateTime(new Date(e.occurredAt), { dateStyle: 'medium', timeStyle: 'short' })}
                  {e.actorName ? ` · ${e.actorName}` : ''}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export function CeremonyHistoryPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('ceremonyHistory');
  const format = useFormatter();
  const [kind, setKind] = useState<CeremonyKind | 'all'>('all');
  const [sessions, setSessions] = useState<CeremonySession[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await ceremonySessionsApi.history(projectId, { kind: kind === 'all' ? undefined : kind });
      setSessions(page.sessions);
      setCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }, [projectId, kind, t]);

  useEffect(() => { void load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await ceremonySessionsApi.history(projectId, {
        kind: kind === 'all' ? undefined : kind,
        before: cursor,
      });
      setSessions((prev) => [...prev, ...page.sessions]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorLoad'));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, projectId, kind, t]);

  const openSession = sessions.find((s) => s.id === openId) ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ViewToggle
          value={kind}
          onChange={(v) => setKind(v as CeremonyKind | 'all')}
          options={[
            { value: 'all', label: t('filterAll') },
            { value: 'standup', label: t('filterStandup') },
            { value: 'planning', label: t('filterPlanning') },
          ]}
        />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('count', { count: sessions.length })}</span>
      </div>

      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 8, fontSize: 13,
          background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)',
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : sessions.length === 0 ? (
        <div style={{
          padding: 20, borderRadius: 12, textAlign: 'center',
          background: 'var(--bg-deep)', border: '1px dashed var(--border-subtle)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t('emptyTitle')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('emptyHelp')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.map((s) => {
            const tone = outcomeTone(s);
            const mins = durationMinutes(s);
            const missed = Math.max(0, (s.humansExpected ?? 0) - (s.humansPresent ?? 0));
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setOpenId(s.id)}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 6, width: '100%',
                  textAlign: 'left', cursor: 'pointer',
                  padding: 12, borderRadius: 10,
                  background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    {t(`kind.${s.kind}`)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {format.dateTime(new Date(s.startedAt), { dateStyle: 'medium', timeStyle: 'short' })}
                    {mins != null && ` · ${t('durationMinutes', { minutes: mins })}`}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ ...CHIP, background: tone.bg, color: tone.fg }}>
                    {t(`closeReason.${s.closeReason ?? 'facilitator'}`)}
                  </span>
                  <span style={{ ...CHIP, background: 'transparent', color: 'var(--text-secondary)' }}>
                    {t('attended', { present: s.humansPresent ?? 0, expected: s.humansExpected ?? 0 })}
                  </span>
                  {missed > 0 && (
                    <span style={{ ...CHIP, background: 'transparent', color: 'var(--text-muted)' }}>
                      {t('missed', { count: missed })}
                    </span>
                  )}
                  {(s.reassignedCount ?? 0) > 0 && (
                    <span style={{ ...CHIP, background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                      {t('reassigned', { count: s.reassignedCount ?? 0 })}
                    </span>
                  )}
                  {(s.dispatchedCount ?? 0) > 0 && (
                    <span style={{ ...CHIP, background: 'transparent', color: 'var(--text-secondary)' }}>
                      {t('dispatched', { count: s.dispatchedCount ?? 0 })}
                    </span>
                  )}
                  {s.concludedBy && s.concludedBy !== 'human' && (
                    <span style={{ ...CHIP, background: 'transparent', color: 'var(--text-muted)' }}>
                      {t(`concludedBy.${s.concludedBy}`)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}

          {cursor && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              style={{
                alignSelf: 'center', minHeight: 40, padding: '8px 16px', borderRadius: 8,
                fontSize: 13, fontWeight: 600, cursor: loadingMore ? 'default' : 'pointer',
                background: 'var(--bg-deep)', color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {loadingMore ? t('loading') : t('loadMore')}
            </button>
          )}
        </div>
      )}

      <SlideOutPanel
        open={!!openSession}
        onClose={() => setOpenId(null)}
        title={openSession
          ? t('detailTitle', {
              kind: t(`kind.${openSession.kind}`),
              when: format.dateTime(new Date(openSession.startedAt), { dateStyle: 'medium', timeStyle: 'short' }),
            })
          : ''}
      >
        {openSession && <SessionDetail sessionId={openSession.id} />}
      </SlideOutPanel>
    </div>
  );
}
