'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  tasksApi,
  type LifecycleEvent,
  type LifecycleEventKind,
  type TicketAutonomyVerdict,
  type TicketLifecycle,
} from '@/lib/builderforceApi';
import { taskStatusLabel } from '@/lib/taskStatus';
import { CopyButton } from '@/components/CopyButton';
import { buildLifecycleDiagnosticsReport } from '@/lib/lifecycleDiagnostics';
import { captureDiagnosticsContext } from '@/lib/diagnosticsCapture';
import { formatDuration } from '@/lib/duration';

/**
 * TicketLifecyclePanel — the per-ticket AUTONOMY PROOF.
 *
 * Answers one question, in terms that cannot be fudged: did this ticket move through
 * its lifecycle by itself, or did a person push it every hop? Reads
 * `GET /api/tasks/:id/lifecycle`, which JOINS four collectors that were already
 * writing (`activity_log`, `task_status_transitions`, `executions`,
 * `tool_audit_events`) — so it answers for tickets closed weeks ago too.
 *
 * Three layers, top to bottom:
 *   1. the VERDICT banner — the sentence, not the numbers;
 *   2. the hop/run tiles — autonomous vs human lane moves, runs, redo;
 *   3. the CHAIN OF CUSTODY timeline — every event tagged with the table it was read
 *      from, so the panel reads as evidence rather than narration.
 *
 * Slide-out, not a modal (app-wide convention: modals are for terminal/destructive
 * approvals only). It opens from INSIDE the board's ticket drawer, which claims
 * z-index 10002/10003, hence the explicit `zIndex` above it.
 */

/** Stacking base so the panel sits above the board's ticket drawer (10002/10003). */
const DRAWER_STACK_BASE = 10010;

/**
 * The visual vocabulary. `agent` = autonomy did it, `accent` = a person did it — that
 * one contrast is what the whole panel is trying to communicate, so it is applied
 * consistently to tiles, event dots and the banner. Accents are layered on
 * `color-mix` fills so both themes get a legible tint (same approach as the audit
 * trail); every base colour is a theme token.
 */
type Tone = 'agent' | 'accent' | 'warn' | 'danger' | 'muted';

const TONE_COLOR: Record<Tone, string> = {
  agent: 'var(--success)',
  accent: 'var(--coral-bright)',
  warn: 'var(--warning)',
  danger: 'var(--error)',
  muted: 'var(--text-muted)',
};

const tint = (tone: Tone, pct: number): string =>
  `color-mix(in srgb, ${TONE_COLOR[tone]} ${pct}%, transparent)`;

/** Event kind → glyph + default tone. Lane moves are re-toned per actor below. */
const KIND_STYLE: Record<LifecycleEventKind, { glyph: string; tone: Tone }> = {
  created:                  { glyph: '✚', tone: 'muted' },
  lane_moved:               { glyph: '→', tone: 'agent' },
  run_dispatched:           { glyph: '▶', tone: 'accent' },
  run_completed:            { glyph: '✔', tone: 'agent' },
  run_failed:               { glyph: '✖', tone: 'danger' },
  autorun_dispatched:       { glyph: '⚡', tone: 'agent' },
  autorun_skipped:          { glyph: '⊘', tone: 'warn' },
  autorun_error:            { glyph: '⚠', tone: 'danger' },
  autorun_awaiting_approval:{ glyph: '⏳', tone: 'warn' },
  // Not a failure and not progress — the run existed but was not advancing.
  run_lifecycle:            { glyph: '⏸', tone: 'warn' },
  role_event:               { glyph: '◆', tone: 'muted' },
};

/** Which banner a verdict earns. PURE, and ordered strictly — the first branch that
 *  matches is the strongest claim the evidence supports. */
interface Banner {
  /** Message key under `ticketLifecycle.verdict`. */
  key: string;
  tone: Tone;
  values: Record<string, number>;
}

export function verdictBanner(v: TicketAutonomyVerdict): Banner {
  const totalHops = v.autonomousHops + v.humanHops;
  // The only unqualified "yes": terminal lane, zero human hops.
  if (v.fullyAutonomous) return { key: 'fullyAutonomous', tone: 'agent', values: { hops: v.autonomousHops } };
  // Nothing ever moved it — say that before making claims about who moved it.
  if (totalHops === 0) return { key: 'noMovement', tone: v.stalled ? 'warn' : 'muted', values: {} };
  if (v.progressedAutonomously && !v.reachedTerminal) {
    return v.stalled
      ? { key: 'partialStalled', tone: 'warn', values: { hops: v.autonomousHops } }
      : { key: 'partialRunning', tone: 'accent', values: { hops: v.autonomousHops } };
  }
  if (v.autonomousHops === 0) return { key: 'humanDriven', tone: 'accent', values: { hops: v.humanHops } };
  return { key: 'assisted', tone: 'accent', values: { humanHops: v.humanHops, totalHops } };
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-elevated)',
  padding: 12,
};

export interface TicketLifecyclePanelProps {
  /** Ticket to audit; `null` keeps the panel closed. */
  taskId: number | null;
  onClose: () => void;
}

export function TicketLifecyclePanel({ taskId, onClose }: TicketLifecyclePanelProps) {
  const t = useTranslations('ticketLifecycle');
  const tCommon = useTranslations('common');
  // Reused catalogs — the actor vocabulary and the auto-run gate reasons are already
  // translated for the audit trail and the swimlane triage popover; re-stating them
  // here would only let them drift.
  const tActor = useTranslations('audit.actor');
  const tReason = useTranslations('board.triage.reason');
  const tLane = useTranslations('pm.epicStatus');
  const locale = useLocale();
  // next-intl types a COMPUTED message key as `never`, which also collapses the
  // `values` argument to `undefined`. The verdict copy is addressed by the key that
  // {@link verdictBanner} picks (always one of the `verdict.*` catalog entries, with
  // its interpolations), so one narrow local alias keeps that indirection instead of
  // hand-unrolling the branch table twice.
  const tVerdict = t as unknown as (key: string, values?: Record<string, number>) => string;

  const [data, setData] = useState<TicketLifecycle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (taskId == null) return;
    setLoading(true);
    setError(null);
    tasksApi.lifecycle(taskId)
      .then((r) => setData(r))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  const fmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );
  const at = useCallback((iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : fmt.format(d);
  }, [fmt]);

  // Custom swimlanes carry keys outside the canonical status enum, so fall back to
  // the humanized key rather than showing a raw `some_custom_lane`.
  const laneLabel = useCallback(
    (key: string | null | undefined): string => {
      if (!key) return '—';
      return tLane.has(key as never) ? tLane(key as never) : taskStatusLabel(key);
    },
    [tLane],
  );
  const actorLabel = useCallback(
    (kind: LifecycleEvent['actorKind']): string => (tActor.has(kind as never) ? tActor(kind as never) : kind),
    [tActor],
  );
  // The gate label a person can act on. The api also ships `stallText` (a fuller
  // English sentence); the localized catalog wins for display and `stallText` is kept
  // as the tooltip / fallback so no locale ever loses the reason entirely.
  const reasonLabel = useCallback(
    (reason: string | null | undefined): string | null => {
      if (!reason) return null;
      return tReason.has(reason as never) ? tReason(reason as never) : null;
    },
    [tReason],
  );

  const verdict = data?.verdict ?? null;
  const banner = verdict ? verdictBanner(verdict) : null;

  /**
   * The EVIDENCE behind the stall reason, as `[label, value, alarming]` rows.
   *
   * Only facts that are actually informative are rendered: a lane with no staffing says
   * so, a clean failure streak is omitted entirely rather than shown as a reassuring
   * zero next to a gate that IS holding the ticket. The streak is flagged `alarming`
   * once it has passed the server's own breaker threshold — that combination (a deep
   * streak that autonomy should already have halted) is the signature of runs arriving
   * from a dispatcher that never consulted the lane trigger.
   */
  const gateFacts = useMemo((): Array<[string, string, boolean]> => {
    const g = data?.gate;
    if (!g) return [];
    const rows: Array<[string, string, boolean]> = [];
    if (g.laneGate) rows.push([t('stall.laneGate'), t(`stall.gate.${g.laneGate}` as never), g.laneGate === 'human']);
    rows.push([
      t('stall.staffed'),
      g.staffedAgentRefs.length > 0 ? g.staffedAgentRefs.join(', ') : t('stall.noneStaffed'),
      g.staffedAgentRefs.length === 0,
    ]);
    rows.push([t('stall.candidate'), g.candidateAgentRef ?? t('stall.noCandidate'), !g.candidateAgentRef]);
    if (g.consecutiveFailures > 0) {
      rows.push([
        t('stall.streak'),
        t('stall.streakValue', { count: g.consecutiveFailures, limit: g.failureBreakerAt }),
        g.consecutiveFailures >= g.failureBreakerAt,
      ]);
    }
    if (g.cooldownRemainingMs > 0) {
      rows.push([t('stall.cooldown'), formatDuration(g.cooldownRemainingMs), false]);
    }
    for (const m of g.capabilityMismatches) {
      rows.push([t('stall.capabilityMismatch'), `${m.agentRef} — ${m.missing.join(', ')}`, true]);
    }
    return rows;
  }, [data?.gate, t]);

  const tiles: Array<{ key: string; value: number; tone: Tone; hint?: string }> = verdict
    ? [
      { key: 'autonomousHops', value: verdict.autonomousHops, tone: 'agent', hint: t('stats.autonomousHopsHint') },
      { key: 'humanHops', value: verdict.humanHops, tone: 'accent', hint: t('stats.humanHopsHint') },
      { key: 'runsDispatched', value: verdict.runsDispatched, tone: 'muted' },
      { key: 'runsCompleted', value: verdict.runsCompleted, tone: verdict.runsCompleted > 0 ? 'agent' : 'muted' },
      { key: 'runsFailed', value: verdict.runsFailed, tone: verdict.runsFailed > 0 ? 'danger' : 'muted' },
      { key: 'backwardHops', value: verdict.backwardHops, tone: verdict.backwardHops > 0 ? 'warn' : 'muted', hint: t('stats.backwardHopsHint') },
    ]
    : [];

  return (
    <SlideOutPanel
      open={taskId != null}
      onClose={onClose}
      zIndex={DRAWER_STACK_BASE}
      width="min(720px, 96vw)"
      title={data ? `${data.key} · ${t('title')}` : t('title')}
    >
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* One-paste handover: the whole ledger + verdict + ids + build versions. A
            screenshot shows the verdict but loses the execution ids, lane keys, gate
            reasons and source tables that make a stall reproducible. Built on click
            (not per render) — it serialises the entire payload. */}
        {data && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <CopyButton
              label={tCommon('copyDiagnostics')}
              ariaLabel={t('copyDiagnosticsAria')}
              getText={async () => buildLifecycleDiagnosticsReport(data, await captureDiagnosticsContext())}
            />
          </div>
        )}

        {loading && !data && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</div>
        )}

        {error && (
          <div style={{ ...cardStyle, borderColor: 'var(--error-border)', background: tint('danger', 10) }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--error-text)' }}>{t('errorTitle')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, overflowWrap: 'anywhere' }}>{error}</div>
            <button
              type="button"
              onClick={load}
              style={{
                marginTop: 10, fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >
              {t('retry')}
            </button>
          </div>
        )}

        {data && verdict && banner && (
          <>
            {/* 1. THE VERDICT — the answer in one sentence, before any numbers. */}
            <section
              style={{
                ...cardStyle,
                background: tint(banner.tone, 12),
                borderColor: tint(banner.tone, 38),
              }}
            >
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {tVerdict(`verdict.${banner.key}`, banner.values)}
                </h3>
                {verdict.hasLiveRun && (
                  <span
                    style={{
                      fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                      color: TONE_COLOR.accent, background: tint('accent', 14),
                      border: `1px solid ${tint('accent', 34)}`, whiteSpace: 'nowrap',
                    }}
                  >
                    {t('verdict.liveRun')}
                  </span>
                )}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                {tVerdict(`verdict.${banner.key}Detail`, banner.values)}
              </p>
            </section>

            {/* A manager grooming card is NOT executable by design, so "it never ran"
                is the intended behaviour and must never read as an autonomy failure. */}
            {verdict.origin === 'manager_card' && (
              <div style={{ ...cardStyle, background: tint('muted', 8) }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {t('verdict.managerCardTitle')}
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                  {t('verdict.managerCard')}
                </div>
              </div>
            )}

            {/* The actionable "why is it sitting there" — the gate holding the ticket,
                WITH the facts behind it. The reason alone ("human_gate") is not
                actionable: the lane's gate setting, its staffing, who Run-now would
                dispatch and how deep the failure streak is are what a fix changes. */}
            {verdict.stalled && (
              <div
                style={{ ...cardStyle, background: tint('warn', 12), borderColor: tint('warn', 38) }}
                title={verdict.stallText ?? undefined}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {t('stall.title')}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {reasonLabel(verdict.stallReason) ?? verdict.stallText ?? t('stall.unrecorded')}
                </div>
                {gateFacts.length > 0 && (
                  <dl style={{ margin: '10px 0 0', display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                    {gateFacts.map(([label, value, alarming]) => (
                      <div key={label} style={{ minWidth: 0 }}>
                        <dt style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{label}</dt>
                        <dd style={{
                          margin: 0, fontSize: 12, fontWeight: 600, overflowWrap: 'anywhere',
                          color: alarming ? TONE_COLOR.danger : 'var(--text-primary)',
                        }}>
                          {value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}

            {/* FAILURE ANALYSIS — the finding, not the rows it came from. A ticket with
                one cause repeating on a fixed interval is a retry loop; showing 134
                identical timeline entries hides that behind scrolling. */}
            {data.failures.length > 0 && (
              <section>
                <h4 style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t('failures.title')}
                </h4>
                <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {t('failures.help')}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.failures.map((f) => (
                    <div key={f.signature} style={{ ...cardStyle, borderColor: tint('danger', 30), background: tint('danger', 8) }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: TONE_COLOR.danger }}>
                          {t('failures.runs', { count: f.runs })}
                        </span>
                        <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          {f.medianIntervalMs == null
                            ? t('failures.cadenceOnce')
                            : t('failures.cadence', { interval: formatDuration(f.medianIntervalMs) })}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)', marginTop: 5, overflowWrap: 'anywhere' }}>
                        {f.sample}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, overflowWrap: 'anywhere' }}>
                        {t('failures.window', { first: at(f.firstAt), last: at(f.lastAt) })}
                        {f.dispatchers.length > 0 && ` · ${t('failures.dispatchedBy', { who: f.dispatchers.join(', ') })}`}
                      </div>
                      <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 3, overflowWrap: 'anywhere' }}>
                        {t('failures.runIds', { ids: f.exampleExecutionIds.map((id) => `#${id}`).join(', ') })}
                        {f.runs > f.exampleExecutionIds.length ? ' …' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* DISPATCHERS — which subsystem started the runs. Anything other than the
                lane trigger reached the dispatcher without passing its circuit breaker,
                so a storm here names the code to go and fix. */}
            {data.dispatchers.length > 0 && (
              <section>
                <h4 style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t('dispatchers.title')}
                </h4>
                <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  {t('dispatchers.help')}
                </p>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.dispatchers.map((d) => (
                    <li
                      key={d.submittedBy}
                      style={{
                        ...cardStyle, padding: '8px 10px', display: 'flex', gap: 8,
                        alignItems: 'baseline', flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                        {d.submittedBy}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 11.5, color: d.failed > 0 ? TONE_COLOR.danger : 'var(--text-secondary)' }}>
                        {t('dispatchers.counts', { runs: d.runs, completed: d.completed, failed: d.failed })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Provenance facts: who opened it, where it sits, when it started. */}
            <dl
              style={{
                margin: 0, display: 'grid', gap: 8,
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              }}
            >
              {([
                [t('origin.label'), t(`origin.${verdict.origin}` as never)],
                [t('currentLane'), laneLabel(verdict.currentStatus)],
                [t('openedAt'), at(data.createdAt)],
              ] as const).map(([label, value]) => (
                <div key={label} style={cardStyle}>
                  <dt style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3 }}>{label}</dt>
                  <dd style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {/* 2. HOPS & RUNS — autonomous vs human, in the same two colours. */}
            <section>
              <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('stats.title')}
              </h4>
              <div
                style={{
                  display: 'grid', gap: 8,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
                }}
              >
                {tiles.map((tile) => (
                  <div
                    key={tile.key}
                    style={{ ...cardStyle, padding: '10px 12px', borderColor: tint(tile.tone, 30), background: tint(tile.tone, 8) }}
                    {...(tile.hint ? { title: tile.hint } : {})}
                  >
                    <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: TONE_COLOR[tile.tone] }}>
                      {tile.value}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
                      {t(`stats.${tile.key}` as never)}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 3. CHAIN OF CUSTODY — every row names the table it came from. */}
            <section>
              <h4 style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                {t('timeline.title')}
              </h4>
              <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {t('timeline.help')}
              </p>

              {data.events.length === 0 ? (
                <div style={{ ...cardStyle, fontSize: 12, color: 'var(--text-muted)' }}>{t('timeline.empty')}</div>
              ) : (
                <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                  {data.events.map((e, i) => {
                    const style = KIND_STYLE[e.kind] ?? KIND_STYLE.role_event;
                    // A lane move is re-toned by WHO made it: that split is the evidence.
                    const tone: Tone = e.kind === 'lane_moved'
                      ? (e.actorKind === 'human' ? 'accent' : 'agent')
                      : style.tone;
                    const glyph = e.kind === 'lane_moved' && e.isBackward === true ? '↩' : style.glyph;
                    const lane = e.fromStatus
                      ? t('timeline.laneMove', { from: laneLabel(e.fromStatus), to: laneLabel(e.toStatus) })
                      : e.toStatus
                        ? t('timeline.laneEntered', { to: laneLabel(e.toStatus) })
                        : null;
                    const reason = reasonLabel(e.reason);
                    const isLast = i === data.events.length - 1;
                    return (
                      <li key={`${e.at}-${e.kind}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
                        {/* Rail: dot + connector. */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 26, flexShrink: 0 }}>
                          <span
                            aria-hidden
                            style={{
                              width: 26, height: 26, borderRadius: 'var(--radius-full)', flexShrink: 0,
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 12, lineHeight: 1, color: TONE_COLOR[tone],
                              background: tint(tone, 14),
                              border: `1px solid ${tint(tone, 40)}`,
                            }}
                          >
                            {glyph}
                          </span>
                          {!isLast && <span style={{ flex: 1, width: 1, minHeight: 10, background: 'var(--border-subtle)' }} />}
                        </div>

                        <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 14 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                              {t(`kind.${e.kind}` as never)}
                            </span>
                            {e.isBackward === true && (
                              <span style={{
                                fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 'var(--radius-full)',
                                color: TONE_COLOR.warn, background: tint('warn', 14),
                                border: `1px solid ${tint('warn', 34)}`, whiteSpace: 'nowrap',
                              }}>
                                {t('timeline.backward')}
                              </span>
                            )}
                            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {at(e.at)}
                            </span>
                          </div>

                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, overflowWrap: 'anywhere' }}>
                            {/* Actor first: the panel is about attribution. */}
                            <span style={{ color: TONE_COLOR[tone], fontWeight: 600 }}>{actorLabel(e.actorKind)}</span>
                            {e.actorName ? ` · ${e.actorName}` : ''}
                            {lane ? ` · ${lane}` : ''}
                            {e.executionId != null ? ` · ${t('timeline.run', { id: e.executionId })}` : ''}
                          </div>

                          {reason && (
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, overflowWrap: 'anywhere' }}>
                              {reason}
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 5 }}>
                            {/* PROVENANCE. The chip shows the source TABLE verbatim — in an
                                audit the exact table is the evidence, so it is a technical
                                identifier (like the ticket key), with the localized name on
                                the tooltip / for screen readers. */}
                            <span
                              title={t('source.aria', { label: t(`source.${e.source}` as never) })}
                              aria-label={t('source.aria', { label: t(`source.${e.source}` as never) })}
                              style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%',
                                fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 7px',
                                borderRadius: 'var(--radius-full)', color: 'var(--text-muted)',
                                background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)',
                                minWidth: 0, overflow: 'hidden',
                              }}
                            >
                              <span aria-hidden>◇</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {e.source}
                              </span>
                            </span>
                            {e.agentRef && (
                              <span style={{
                                fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 'var(--radius-full)',
                                color: 'var(--text-muted)', border: '1px dashed var(--border-subtle)',
                                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {e.agentRef}
                              </span>
                            )}
                            {/* WHICH dispatcher started this run — on a stalled ticket
                                this chip is usually the answer to "who keeps doing this". */}
                            {e.dispatchedBy && (
                              <span
                                title={t('timeline.dispatchedBy', { who: e.dispatchedBy })}
                                style={{
                                  fontSize: 10, fontFamily: 'var(--font-mono)', padding: '2px 7px', borderRadius: 'var(--radius-full)',
                                  color: 'var(--text-muted)', background: 'var(--bg-hover)',
                                  border: '1px solid var(--border-subtle)',
                                  maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}
                              >
                                ▶ {e.dispatchedBy}
                              </span>
                            )}
                          </div>

                          {/* Free-form server detail (error message, activity summary). Wide
                              content scrolls inside its own box so the panel never does. */}
                          {e.detail && (
                            <div
                              className="scroll-x"
                              style={{
                                marginTop: 5, fontSize: 11.5, lineHeight: 1.5, color: 'var(--text-muted)',
                                overflowWrap: 'anywhere', maxHeight: 120, overflowY: 'auto',
                              }}
                            >
                              {e.detail}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>

            {loading && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tCommon('loading')}</div>
            )}
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}
