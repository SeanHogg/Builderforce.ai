'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiRequest } from '@/lib/apiClient';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { ContinueAdvisor } from '@/components/freelance/ContinueAdvisor';

interface AdvisorSession {
  id: number;
  status: string;
  hostRef: string | null;
  serviceId: number | null;
  startsAt: string;
  endsAt: string;
  meetingUrl: string | null;
}

const HEADING = 'text-lg font-medium text-[var(--text-primary)]';
const MUTED = 'text-sm text-[var(--text-secondary)]';
const INPUT = 'min-h-[44px] rounded border border-[var(--border)] bg-[var(--surface-card)] px-2 py-1 text-[var(--text-primary)]';
const SECONDARY_BUTTON = 'min-h-[44px] rounded border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-primary)]';

/**
 * Founder-facing advisory surface (epic #2545 A2).
 *
 * Books through `POST /api/advisory/sessions` (the existing reservation path)
 * and shows the founder's upcoming sessions plus the advisor's own roster.
 * Continue-with-advisor and the stored relation are the practice-ops booking
 * endpoints — this page does not invent a second booking table.
 */
export function AdvisoryClient() {
  const t = useTranslations('advisory');
  const errorMessage = useErrorMessage();
  const [sessions, setSessions] = useState<AdvisorSession[]>([]);
  const [roster, setRoster] = useState<AdvisorSession[]>([]);
  const [history, setHistory] = useState<AdvisorSession[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [hostRef, setHostRef] = useState('');
  const [continueAt, setContinueAt] = useState('');
  const [relationId, setRelationId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiRequest<{ sessions: AdvisorSession[] }>('/api/advisory/sessions'),
      apiRequest<{ sessions: AdvisorSession[] }>('/api/practice-ops/booking/advisor-roster'),
      apiRequest<{ sessions: AdvisorSession[] }>('/api/practice-ops/booking/advisor-history'),
    ]).then(([mine, hosted, done]) => {
      if (cancelled) return;
      setSessions(mine.sessions ?? []);
      setRoster(hosted.sessions ?? []);
      setHistory(done.sessions ?? []);
    }).catch((err: unknown) => {
      if (!cancelled) setError(errorMessage(err));
    });
    return () => { cancelled = true; };
  }, [reloadKey, errorMessage]);

  async function run(label: string, work: () => Promise<unknown>) {
    setError(null);
    setMessage(null);
    try {
      await work();
      setMessage(label);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const continuable = history.filter((row) => row.hostRef && row.serviceId != null);

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{t('title')}</h1>
        <p className={MUTED}>{t('intro')}</p>
      </header>

      {error && <p role="alert" className="text-sm text-[var(--error-text)]">{error}</p>}
      {message && <p role="status" className="text-sm text-[var(--success-text)]">{message}</p>}

      <section className="space-y-3">
        <h2 className={HEADING}>{t('bookHeading')}</h2>
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(t('booked'), () =>
              apiRequest('/api/advisory/sessions', {
                method: 'POST',
                body: JSON.stringify({
                  serviceId: Number(serviceId),
                  startsAt: new Date(startsAt).toISOString(),
                  ...(hostRef ? { hostRef } : {}),
                }),
              }),
            );
          }}
        >
          <label className={MUTED}>
            {t('serviceId')}
            <input className={`mt-1 w-full ${INPUT}`} value={serviceId} onChange={(e) => setServiceId(e.target.value)} required inputMode="numeric" />
          </label>
          <label className={MUTED}>
            {t('startsAt')}
            <input className={`mt-1 w-full ${INPUT}`} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </label>
          <label className={`${MUTED} sm:col-span-2`}>
            {t('hostRef')}
            <input className={`mt-1 w-full ${INPUT}`} value={hostRef} onChange={(e) => setHostRef(e.target.value)} />
          </label>
          <button type="submit" className="min-h-[44px] rounded bg-[var(--accent)] px-3 py-2 text-sm text-[var(--text-on-accent)] sm:col-span-2">
            {t('book')}
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className={HEADING}>{t('upcomingHeading')}</h2>
        <SessionList rows={sessions} empty={t('noUpcoming')} />
      </section>

      <section className="space-y-3">
        <h2 className={HEADING}>{t('completedHeading')}</h2>
        {continuable.length === 0 ? (
          <p className={MUTED}>{t('noCompleted')}</p>
        ) : (
          continuable.map((row) => (
            <ContinueAdvisor
              key={row.id}
              session={{
                reservationId: row.id,
                advisorUserId: row.hostRef as string,
                serviceId: row.serviceId as number,
              }}
              advisorName={row.hostRef}
              onContinued={reload}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className={HEADING}>{t('relationHeading')}</h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(t('continued'), () =>
              apiRequest('/api/practice-ops/booking/advisor-continue', {
                method: 'POST',
                body: JSON.stringify({ startsAt: new Date(continueAt).toISOString() }),
              }),
            );
          }}
        >
          <input
            className={`min-w-0 flex-1 ${INPUT}`}
            type="datetime-local"
            aria-label={t('startsAt')}
            value={continueAt}
            onChange={(e) => setContinueAt(e.target.value)}
            required
          />
          <button type="submit" className={SECONDARY_BUTTON}>{t('continue')}</button>
        </form>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(t('relationSaved'), () =>
              apiRequest('/api/practice-ops/booking/advisor-relation', {
                method: 'POST',
                body: JSON.stringify({ reservationId: Number(relationId) }),
              }),
            );
          }}
        >
          <input
            className={`min-w-0 flex-1 ${INPUT}`}
            value={relationId}
            onChange={(e) => setRelationId(e.target.value)}
            placeholder={t('reservationId')}
            aria-label={t('reservationId')}
            required
            inputMode="numeric"
          />
          <button type="submit" className={SECONDARY_BUTTON}>{t('saveRelation')}</button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className={HEADING}>{t('rosterHeading')}</h2>
        <SessionList rows={roster} empty={t('noRoster')} />
      </section>
    </main>
  );
}

function SessionList({ rows, empty }: { rows: AdvisorSession[]; empty: string }) {
  if (rows.length === 0) return <p className={MUTED}>{empty}</p>;
  return (
    <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)] bg-[var(--surface-card)]">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm text-[var(--text-primary)]">
          <span className="min-w-0 break-words">#{row.id} · {row.status}{row.hostRef ? ` · ${row.hostRef}` : ''}</span>
          <span className="text-[var(--text-secondary)]">{new Date(row.startsAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
