'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { MeetingMinutesPanel } from '@/components/meetings/MeetingMinutesPanel';
import { ViewToggle } from '@/components/ViewToggle';
import { Select } from '@/components/Select';
import { usePermission } from '@/lib/rbac';
import {
  ceremonySessionsApi,
  CEREMONY_CORRECTABLE,
  type CeremonyKind,
  type CeremonySession,
  type CeremonyParticipant,
  type CeremonyJournalEvent,
  type CeremonyAttendance,
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
  padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: 11, fontWeight: 600,
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

/**
 * One seat's attendance, correctable in place.
 *
 * The correction control decides its OWN visibility from `manager.manage` — the row is
 * rendered identically for everyone and simply falls back to a static chip without the
 * capability, so no caller has to thread a `canCorrect` boolean it would compute the
 * same way. The server's `requireRole(MANAGER)` is the real authority either way.
 *
 * Correcting matters because the verdict is DERIVED (presence heartbeat + speaking time)
 * and 'absent' is an input to the rules that can hand this person's work to an agent.
 * Someone who dialled in by phone must be able to be marked present after the fact.
 */
function AttendanceRow({
  p, sessionId, onCorrected,
}: {
  p: CeremonyParticipant;
  sessionId: string;
  onCorrected: (participants: CeremonyParticipant[]) => void;
}) {
  const t = useTranslations('ceremonyHistory');
  const { allowed: canCorrect } = usePermission('manager.manage');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHuman = p.memberKind === 'human';
  const verdict = p.attendance ?? 'unknown';
  const source = p.attendanceSource ?? 'derived';
  const tone = verdict === 'present'
    ? { bg: 'var(--bg-elevated)', fg: 'var(--text-primary)' }
    : { bg: 'transparent', fg: 'var(--text-muted)' };

  const correct = async (next: string) => {
    if (next === verdict) return;
    setBusy(true);
    try {
      const d = await ceremonySessionsApi.correctAttendance(sessionId, p.id, next as CeremonyAttendance);
      onCorrected([...(d.participants ?? [])].sort((a, b) => a.turnOrder - b.turnOrder));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errorCorrect'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
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
          {/* Agents cannot be absent, so their verdict is never correctable. */}
          {canCorrect && isHuman ? (
            <Select
              value={verdict === 'unknown' ? '' : verdict}
              disabled={busy}
              aria-label={t('correctAria', { name: p.memberName })}
              onChange={(e) => void correct(e.target.value)}
              style={{
                minHeight: 32, padding: '4px 8px', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600,
                background: 'var(--bg-base)', color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {verdict === 'unknown' && <option value="">{t('attendance.unknown')}</option>}
              {CEREMONY_CORRECTABLE.map((v) => (
                <option key={v} value={v}>{t(`attendance.${v}`)}</option>
              ))}
            </Select>
          ) : (
            <span style={{ ...CHIP, background: tone.bg, color: tone.fg }}>{t(`attendance.${verdict}`)}</span>
          )}
        </div>
      </div>

      {/* Provenance — why this reads the way it does, without anyone knowing the rules.
          Keyed off the source rather than branched on it: this was a two-way ternary that
          fell through to "corrected by a manager", so the day a THIRD source arrived
          (`rsvp`, a person declining the invitation) every declined seat claimed a manager
          had asserted it — the one line whose whole job is to say where a verdict came
          from, naming the wrong origin. A lookup cannot fall through. */}
      {source !== 'derived' && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          {t(`source.${source}`)}
          {p.attendanceNote ? ` — ${p.attendanceNote}` : ''}
        </div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--error-text)', marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const t = useTranslations('ceremonyHistory');
  const format = useFormatter();
  const [participants, setParticipants] = useState<CeremonyParticipant[]>([]);
  const [journal, setJournal] = useState<CeremonyJournalEvent[]>([]);
  const [meetingId, setMeetingId] = useState<string | null>(null);
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
        setMeetingId(d.session?.meetingId ?? null);
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
          : participants.map((p) => (
              <AttendanceRow key={p.id} p={p} sessionId={sessionId} onCorrected={setParticipants} />
            ))}
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

      {/* What was SAID. The record of a ceremony used to stop at what the platform did
          to the board; the minutes and the transcript lived on the companion meeting and
          were reachable only from the meetings list, so the one page answering "what
          happened at Tuesday's standup" could not show what anyone talked about. Same
          component the meetings list opens — the record has one implementation. */}
      <section>
        <MeetingMinutesPanel meetingId={meetingId} />
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
          padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: 13,
          background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)',
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : sessions.length === 0 ? (
        <div style={{
          padding: 20, borderRadius: 'var(--radius-lg)', textAlign: 'center',
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
                  padding: 12, borderRadius: 'var(--radius-lg)',
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
                alignSelf: 'center', minHeight: 40, padding: '8px 16px', borderRadius: 'var(--radius-md)',
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
        widthStorageKey="ceremony-history-detail"
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
