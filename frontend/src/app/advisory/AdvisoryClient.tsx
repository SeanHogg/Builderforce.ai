'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, faultMessage } from '@/lib/apiClient';
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

/**
 * Founder-facing advisory surface (epic #2545 A2).
 *
 * Books through `POST /api/advisory/sessions` (the existing reservation path)
 * and shows the founder's upcoming sessions plus the advisor's own roster.
 * Continue-with-advisor and the stored relation are the practice-ops booking
 * endpoints — this page does not invent a second booking table.
 */
export function AdvisoryClient() {
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

  const load = useCallback(async () => {
    const [mine, hosted, done] = await Promise.all([
      apiRequest<{ sessions: AdvisorSession[] }>('/api/advisory/sessions'),
      apiRequest<{ sessions: AdvisorSession[] }>('/api/practice-ops/booking/advisor-roster'),
      apiRequest<{ sessions: AdvisorSession[] }>('/api/practice-ops/booking/advisor-history'),
    ]);
    setSessions(mine.sessions ?? []);
    setRoster(hosted.sessions ?? []);
    setHistory(done.sessions ?? []);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => setError(faultMessage(err, 'Could not load advisory sessions')));
  }, [load]);

  async function run(label: string, work: () => Promise<unknown>) {
    setError(null);
    setMessage(null);
    try {
      await work();
      setMessage(label);
      await load();
    } catch (err) {
      setError(faultMessage(err, 'Request failed'));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Advisory</h1>
        <p className="text-sm text-neutral-600">
          Book a session with an advisor, keep the relationship, and continue from the last one.
        </p>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-700">{message}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Book a session</h2>
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run('Session booked', () =>
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
          <label className="text-sm">
            Service id
            <input className="mt-1 w-full rounded border px-2 py-1" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required inputMode="numeric" />
          </label>
          <label className="text-sm">
            Starts
            <input className="mt-1 w-full rounded border px-2 py-1" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
          </label>
          <label className="text-sm sm:col-span-2">
            Advisor (host ref, optional)
            <input className="mt-1 w-full rounded border px-2 py-1" value={hostRef} onChange={(e) => setHostRef(e.target.value)} />
          </label>
          <button type="submit" className="rounded bg-neutral-900 px-3 py-2 text-sm text-white sm:col-span-2">Book</button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Your upcoming sessions</h2>
        <SessionList rows={sessions} empty="No upcoming sessions." />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Completed sessions</h2>
        {history.filter((row) => row.hostRef && row.serviceId != null).length === 0 ? (
          <p className="text-sm text-neutral-500">No completed sessions to continue.</p>
        ) : (
          history.filter((row) => row.hostRef && row.serviceId != null).map((row) => (
            <ContinueAdvisor
              key={row.id}
              session={{
                reservationId: row.id,
                advisorUserId: row.hostRef as string,
                serviceId: row.serviceId as number,
              }}
              advisorName={row.hostRef}
              onContinued={() => void load()}
            />
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Continue from the saved relationship</h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run('Continued with your advisor', () =>
              apiRequest('/api/practice-ops/booking/advisor-continue', {
                method: 'POST',
                body: JSON.stringify({ startsAt: new Date(continueAt).toISOString() }),
              }),
            );
          }}
        >
          <input className="rounded border px-2 py-1" type="datetime-local" value={continueAt} onChange={(e) => setContinueAt(e.target.value)} required />
          <button type="submit" className="rounded border px-3 py-1 text-sm">Continue</button>
        </form>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run('Advisor relationship saved', () =>
              apiRequest('/api/practice-ops/booking/advisor-relation', {
                method: 'POST',
                body: JSON.stringify({ reservationId: Number(relationId) }),
              }),
            );
          }}
        >
          <input className="rounded border px-2 py-1" value={relationId} onChange={(e) => setRelationId(e.target.value)} placeholder="Reservation id" required inputMode="numeric" />
          <button type="submit" className="rounded border px-3 py-1 text-sm">Save as my advisor</button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Sessions you are hosting</h2>
        <SessionList rows={roster} empty="Nothing on your roster." />
      </section>
    </main>
  );
}

function SessionList({ rows, empty }: { rows: AdvisorSession[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">{empty}</p>;
  return (
    <ul className="divide-y rounded border">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap justify-between gap-2 px-3 py-2 text-sm">
          <span>#{row.id} · {row.status}{row.hostRef ? ` · ${row.hostRef}` : ''}</span>
          <span>{new Date(row.startsAt).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
