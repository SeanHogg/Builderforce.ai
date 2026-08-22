'use client';

/**
 * CronPanel — the operator control for the platform's scheduled work.
 *
 * WHY IT EXISTS. Cloudflare delivers cron triggers to the Worker's `scheduled()`
 * handler, never to a URL, so until this panel there was no way inside the product
 * to answer "did the sweep run, and what did it do?" — only `wrangler tail`, and
 * only if you were watching at the right moment. Worse, the frequent tick is
 * KV-gated and the pending-work signal only fires when a ticket actually PASSES
 * its gates, so a board of stalled tickets signals nothing and falls through to
 * the 30-minute floor: a cron-path change could take half an hour to observe.
 *
 * Two distinct controls, deliberately separate:
 *   • Run now — force-runs the sweeps a real tick would run, BYPASSING the gate.
 *     Verifies the sweep's own logic in seconds.
 *   • Signal pending work — sets the KV flag so the NEXT real tick runs the
 *     fan-out. Verifies the GATE, which "Run now" cannot.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  adminApi,
  type AdminCronCadence,
  type AdminCronOutcome,
  type AdminCronState,
} from '@/lib/adminApi';
import { useConfirm } from '@/components/ConfirmProvider';
import { AdminError, AdminLoading, AdminPanelHeader, errText, useAdminData } from '../adminShared';
import { useAdminFormat } from '../adminShared';

const CADENCE_ORDER: readonly AdminCronCadence[] = ['frequent', 'daily', 'weekly-mon', 'weekly-fri'];

/** ms → a compact operator-readable duration ("45s", "30m", "6h"). */
function fmtInterval(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(ms % 3_600_000 === 0 ? 0 : 1)}h`;
}

export default function CronPanel() {
  const { fmtDateTime } = useAdminFormat();
  const t = useTranslations('admin.cron');
  const confirm = useConfirm();
  const { data, loading, error, reload, setError } = useAdminData<AdminCronState>(() => adminApi.cronState());

  const [outcomes, setOutcomes] = useState<Record<string, AdminCronOutcome>>({});
  const [busy, setBusy] = useState('');
  const [lastRun, setLastRun] = useState<{ target: string; ok: number; total: number; ms: number; dispatched: number } | null>(null);
  const [signalled, setSignalled] = useState(false);

  const byCadence = useMemo(() => {
    const map = new Map<AdminCronCadence, AdminCronState['sweeps']>();
    for (const cadence of CADENCE_ORDER) map.set(cadence, []);
    for (const sweep of data?.sweeps ?? []) {
      if (!map.has(sweep.cadence)) map.set(sweep.cadence, []);
      map.get(sweep.cadence)!.push(sweep);
    }
    return map;
  }, [data]);

  /**
   * Force-run `target` (a sweep key, a cadence, or 'all'). Anything that can start
   * billable agent runs across tenants is confirmed first — this is a real
   * dispatch, not a dry run.
   */
  const run = async (target: string) => {
    const affected = target === 'all'
      ? (data?.sweeps ?? [])
      : (data?.sweeps ?? []).filter((s) => s.key === target || s.cadence === target);
    const dispatching = affected.filter((s) => s.dispatches && s.enabled);
    if (dispatching.length > 0) {
      const ok = await confirm({
        title: t('confirm.title'),
        message: t('confirm.dispatch', { target, count: dispatching.length }),
        confirmLabel: t('confirm.confirmLabel'),
        destructive: false,
      });
      if (!ok) return;
    }
    try {
      setBusy(target);
      setError('');
      const result = await adminApi.cronRun(target);
      setOutcomes((prev) => {
        const next = { ...prev };
        for (const outcome of result.results) next[outcome.key] = outcome;
        return next;
      });
      setLastRun({
        target,
        ok: result.results.filter((r) => r.ok).length,
        total: result.results.length,
        ms: result.totalMs,
        dispatched: result.dispatchesReserved,
      });
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  /** Arm the KV gate so the next real tick runs the fan-out — tests the gate itself. */
  const signal = async () => {
    try {
      setBusy('signal');
      setError('');
      await adminApi.cronSignal();
      setSignalled(true);
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  const toggle = async (key: string, enabled: boolean) => {
    try {
      setBusy(`toggle:${key}`);
      setError('');
      await adminApi.cronSetEnabled(key, enabled);
      reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy('');
    }
  };

  if (loading && !data) return <AdminLoading />;

  const gate = data?.gate;
  const stall = data?.scheduleStall ?? null;
  const gateTone = !gate ? 'neutral' : gate.reason === 'idle' ? 'neutral' : gate.reason === 'kv-unavailable' ? 'warning' : 'success';
  const toneColor = gateTone === 'success' ? 'var(--success)' : gateTone === 'warning' ? 'var(--warning)' : 'var(--text-muted)';

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        onRefresh={reload}
        actions={(
          <>
            <button
              type="button"
              className="btn-ghost"
              disabled={Boolean(busy)}
              onClick={() => void run('frequent')}
            >
              {busy === 'frequent' ? t('actions.running') : t('actions.runFrequent')}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={Boolean(busy) || gate?.kvBound === false}
              title={gate?.kvBound === false ? t('gate.kvUnbound') : undefined}
              onClick={() => void signal()}
            >
              {busy === 'signal' ? t('actions.running') : t('actions.signal')}
            </button>
          </>
        )}
      />
      <AdminError message={error} />

      {/* ---- KV work-gate: why the next tick will or won't touch Postgres ---- */}
      {gate && (
        <div className="health-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <div className="health-label">{t('gate.heading')}</div>
            <span className="text-muted" style={{ fontSize: 12 }}>{t('gate.checkedAt', { at: data?.now ? fmtDateTime(data.now) : '—' })}</span>
          </div>
          <div style={{ color: toneColor, fontWeight: 700, fontSize: 16, marginTop: 4 }}>
            {gate.wouldRun ? t('gate.wouldRun') : t('gate.wouldSkip')}
            <span className="text-muted" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>
              {t(`gate.reason.${gate.reason}`)}
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>{t('gate.floorInterval')}</div>
              <div style={{ fontWeight: 600 }}>
                {fmtInterval(gate.floorIntervalMs)}
                {gate.floorIntervalOverridden && (
                  <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{t('gate.overridden')}</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>{t('gate.lastFloor')}</div>
              <div style={{ fontWeight: 600 }}>{gate.lastFloorSweepAt ? fmtDateTime(gate.lastFloorSweepAt) : t('gate.never')}</div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>{t('gate.nextFloor')}</div>
              <div style={{ fontWeight: 600 }}>{gate.nextFloorDueAt ? fmtDateTime(gate.nextFloorDueAt) : t('gate.asap')}</div>
            </div>
            {/* The dynamic half of the gate: a schedule coming due wakes the tick
                ahead of the floor. `stuck` is called out because it reads as "nothing
                due" everywhere else — that is exactly the confusion this replaces. */}
            <div>
              <div className="text-muted ui-text-small">{t('gate.nextDue')}</div>
              <div style={{ fontWeight: 600, color: gate.dueState === 'stuck' ? 'var(--warning)' : undefined }}>
                {gate.nextDueAt ? fmtDateTime(gate.nextDueAt) : t('gate.noSchedules')}
                <span className="text-muted ui-text-small" style={{ fontWeight: 400, marginLeft: 6 }}>
                  {t(`gate.dueState.${gate.dueState}`)}
                </span>
              </div>
            </div>
          </div>
          {/* The non-obvious part: an idle gate is not "nothing is wrong", it is
              "nothing signalled", and stalled tickets never signal. */}
          {!gate.wouldRun && (
            <p className="text-muted" style={{ fontSize: 12, margin: '12px 0 0' }}>{t('gate.explainIdle')}</p>
          )}
          {gate.kvBound === false && (
            <p style={{ fontSize: 12, margin: '12px 0 0', color: 'var(--warning)' }}>{t('gate.kvUnbound')}</p>
          )}
          {signalled && (
            <p style={{ fontSize: 12, margin: '12px 0 0', color: 'var(--success)' }}>{t('gate.signalled')}</p>
          )}
        </div>
      )}

      {/* ---- Jammed, not idle ---------------------------------------------------
          An armed schedule row overdue by more than a floor interval has already had
          its chance at every sweep. The gate deliberately stops treating it as due —
          otherwise it would wake Neon on every tick — so without this banner the
          condition is invisible and looks identical to a quiet platform. */}
      {stall && (
        <div
          className="health-card"
          role="status"
          style={{ padding: 16, marginBottom: 16, borderColor: 'var(--warning)' }}
        >
          <div className="health-label" style={{ color: 'var(--warning)' }}>
            {t('stall.heading', { count: stall.tables.length })}
          </div>
          <p className="ui-text-body" style={{ margin: '4px 0 0', color: 'var(--text-primary)' }}>
            {t('stall.since', { since: fmtDateTime(stall.jammedSince), observations: stall.observations })}
          </p>
          <p className="text-muted ui-text-small" style={{ margin: '8px 0 0' }}>{t('stall.explain')}</p>
          <ul className="ui-text-body" style={{ margin: '8px 0 0', paddingInlineStart: 20 }}>
            {stall.tables.map((entry) => (
              <li key={entry.table} style={{ marginTop: 2 }}>
                <code className="ui-text-small">{entry.table}</code>{' '}
                <span className="text-muted">
                  {t('stall.overdue', { due: fmtDateTime(entry.dueAt), overdue: fmtInterval(entry.overdueMs) })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {lastRun && (
        <div className="health-card" style={{ padding: 12, marginBottom: 16 }}>
          <span style={{ fontWeight: 600 }}>{t('result.heading', { target: lastRun.target })}</span>{' '}
          <span className="text-muted">
            {t('result.summary', { ok: lastRun.ok, total: lastRun.total, ms: lastRun.ms, dispatched: lastRun.dispatched })}
          </span>
        </div>
      )}

      <p className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>{t('forceNote')}</p>

      {CADENCE_ORDER.map((cadence) => {
        const sweeps = byCadence.get(cadence) ?? [];
        if (sweeps.length === 0) return null;
        const cron = data?.cadences.find((c) => c.cadence === cadence)?.cron ?? null;
        return (
          <section key={cadence} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>
                {t(`cadence.${cadence}`)}
                <code className="text-muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                  {cron ?? t('cadence.everyFiveMinutes')}
                </code>
              </h3>
              <button
                type="button"
                className="btn-ghost"
                disabled={Boolean(busy)}
                onClick={() => void run(cadence)}
              >
                {busy === cadence ? t('actions.running') : t('actions.runGroup')}
              </button>
            </div>
            <div className="table-wrap">
              <table className="data-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>{t('table.sweep')}</th>
                    <th>{t('table.description')}</th>
                    <th>{t('table.lastRun')}</th>
                    <th>{t('table.enabled')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sweeps.map((sweep) => {
                    const outcome = outcomes[sweep.key];
                    return (
                      <tr key={sweep.key}>
                        <td>
                          <code style={{ fontSize: 12 }}>{sweep.key}</code>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                            {sweep.dispatches && <span className="badge badge-neutral">{t('badge.dispatches')}</span>}
                            {!sweep.available && <span className="badge badge-neutral">{t('badge.unavailable')}</span>}
                            {!sweep.enabled && <span className="badge badge-neutral">{t('badge.paused')}</span>}
                          </div>
                        </td>
                        <td className="text-muted">{sweep.description}</td>
                        <td>
                          {!outcome ? (
                            <span className="text-muted">—</span>
                          ) : outcome.skipped ? (
                            <span className="text-muted">{t('outcome.skipped')}</span>
                          ) : outcome.timedOut ? (
                            <span style={{ color: 'var(--warning)' }}>{t('outcome.timedOut', { ms: outcome.ms })}</span>
                          ) : !outcome.ok ? (
                            <span style={{ color: 'var(--error)' }}>{t('outcome.failed')}: {outcome.error}</span>
                          ) : (
                            <span style={{ color: 'var(--success)' }}>
                              {t('outcome.ok', { ms: outcome.ms })}
                              <span className="text-muted" style={{ marginLeft: 6 }}>
                                {outcome.summary ?? t('outcome.noop')}
                              </span>
                            </span>
                          )}
                        </td>
                        <td>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: data?.controlsPersisted ? 'pointer' : 'not-allowed' }}>
                            <input
                              type="checkbox"
                              aria-label={t('actions.toggle', { sweep: sweep.key })}
                              checked={sweep.enabled}
                              disabled={Boolean(busy) || !data?.controlsPersisted}
                              onChange={(event) => void toggle(sweep.key, event.target.checked)}
                            />
                            <span className="text-muted" style={{ fontSize: 12 }}>
                              {sweep.enabled ? t('status.on') : t('status.off')}
                            </span>
                          </label>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-ghost"
                            disabled={Boolean(busy) || !sweep.available || !sweep.enabled}
                            onClick={() => void run(sweep.key)}
                          >
                            {busy === sweep.key ? t('actions.running') : t('actions.run')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
