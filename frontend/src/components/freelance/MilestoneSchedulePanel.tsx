'use client';

/**
 * Fixed-price milestones + escrow, for both sides of the deal.
 *
 * ── ONE COMPONENT, TWO SURFACES ──────────────────────────────────────────────────
 * The client's engagement panel and the freelancer's "what am I owed" list are the same
 * schedule read from opposite ends, so they are one row renderer and two thin loaders.
 * What differs between them is entirely DATA: which endpoint the rows came from, and
 * which moves the server said this party may make. Nothing in this file branches on
 * "am I the client" — a boolean the surface would inevitably start deciding policy with.
 *
 * ── THE BUTTONS ARE NOT THIS FILE'S DECISION ─────────────────────────────────────
 * Every action button comes from `row.actions`, which the API computed with the escrow
 * state machine that will judge the request. So a surface literally cannot offer a move
 * the machine would refuse, and adding a state or changing who may do what is a server
 * change with no edit here. See `lib/milestonesApi.ts` for the full argument.
 *
 * Destructive moves (`cancel`) route through the shared `useConfirm` modal, per the
 * convention that modals exist for destructive approvals and nothing else.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { formatCents } from '@/lib/canvasMoney';
import {
  addEngagementMilestone, addJobMilestone, deleteMilestone, getEngagementSchedule, getJobSchedule,
  listMyMilestones, runMilestoneAction, isTransacted,
  type EscrowSummary, type MilestoneAction, type MilestoneDraft, type MilestoneRow,
  type MilestoneStatus, type WorkGate,
} from '@/lib/milestonesApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const input: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)', padding: '7px 10px', fontSize: 'var(--font-size-small)',
  outline: 'none', minWidth: 0, width: '100%',
};
const btn = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-small)',
  fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  border: variant === 'primary' ? 'none' : `1px solid ${variant === 'danger' ? 'var(--error)' : 'var(--border-subtle)'}`,
  background: variant === 'primary' ? 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))' : 'var(--bg-elevated)',
  color: variant === 'primary' ? 'var(--text-on-accent)' : variant === 'danger' ? 'var(--error)' : 'var(--text-primary)',
});

/** Status → the token that carries its meaning in BOTH themes. Declared as data beside
 *  the machine's states so a new state cannot silently fall back to body text. */
const STATUS_TONE: Record<MilestoneStatus, string> = {
  draft: 'var(--text-muted)',
  funded: 'var(--cyan-bright, var(--cyan-bright))',
  submitted: 'var(--warning-text, var(--warning))',
  approved: 'var(--success)',
  released: 'var(--success)',
  cancelled: 'var(--text-muted)',
  disputed: 'var(--error)',
};

/** The moves that need a reason typed before they are sent. */
const NEEDS_NOTE: ReadonlySet<MilestoneAction> = new Set<MilestoneAction>(['reject', 'submit']);
/** The moves that ask first, because they end something or move money out. */
const NEEDS_CONFIRM: ReadonlySet<MilestoneAction> = new Set<MilestoneAction>(['cancel', 'release', 'fund']);

const money = (cents: number, currency = 'USD') => formatCents(cents, { currency });

function StatusPill({ status }: { status: MilestoneStatus }) {
  const t = useTranslations('milestones');
  return (
    <span style={{
      fontSize: 'var(--font-size-eyebrow)', fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.05em', color: STATUS_TONE[status], whiteSpace: 'nowrap',
    }}>
      {t(`status.${status}`)}
    </span>
  );
}

/** The five numbers, as tiles that wrap rather than overflow on a phone. */
function EscrowSummaryTiles({ summary, currency }: { summary: EscrowSummary; currency: string }) {
  const t = useTranslations('milestones');
  const tiles: Array<{ key: keyof EscrowSummary; tone: string }> = [
    { key: 'agreedCents', tone: 'var(--text-primary)' },
    { key: 'heldCents', tone: 'var(--cyan-bright, var(--cyan-bright))' },
    { key: 'owedCents', tone: 'var(--warning-text, var(--warning))' },
    { key: 'releasedCents', tone: 'var(--success)' },
    { key: 'unfundedCents', tone: 'var(--text-muted)' },
  ];
  return (
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
      {tiles.map(({ key, tone }) => (
        <div key={key} style={{ ...card, padding: 12 }}>
          <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t(`summary.${key}`)}
          </div>
          <div style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: tone, marginTop: 4 }}>
            {money(summary[key], currency)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The funded-before-work gate, said in a sentence rather than implied by an empty list. */
function GateBanner({ gate }: { gate: WorkGate }) {
  const t = useTranslations('milestones');
  // An hourly engagement is not governed by escrow at all — saying so would be noise.
  if (gate.reason === 'not_fixed_price') return null;
  const ok = gate.authorised;
  return (
    <div style={{
      ...card, padding: '10px 14px', fontSize: 'var(--font-size-small)',
      background: ok ? 'var(--surface-success-soft, var(--bg-elevated))' : 'var(--bg-elevated)',
      borderColor: ok ? 'var(--success)' : 'var(--warning-text, var(--warning))',
      color: ok ? 'var(--success)' : 'var(--warning-text, var(--warning))',
    }}>
      {t(`gate.${gate.reason}`)}
    </div>
  );
}

interface RowsProps {
  milestones: MilestoneRow[];
  busy: string | null;
  /** Runs one action; the caller owns the token split and the reload. */
  onAction: (row: MilestoneRow, action: MilestoneAction, note?: string) => void;
  /** Only ever offered for a draft the caller owns; omitted where removal is not theirs. */
  onRemove?: (row: MilestoneRow) => void;
  /** Worker rows carry which engagement and which client they belong to. */
  showContext?: boolean;
}

function MilestoneRows({ milestones, busy, onAction, onRemove, showContext }: RowsProps) {
  const t = useTranslations('milestones');
  const confirm = useConfirm();
  const [noteFor, setNoteFor] = useState<{ id: string; action: MilestoneAction } | null>(null);
  const [note, setNote] = useState('');

  const run = async (row: MilestoneRow, action: MilestoneAction) => {
    if (NEEDS_NOTE.has(action) && noteFor?.id !== row.id) {
      setNoteFor({ id: row.id, action });
      setNote('');
      return;
    }
    if (NEEDS_CONFIRM.has(action)) {
      const agreed = await confirm({
        message: t(`confirm.${action}`, { amount: money(row.amountCents, row.currency) }),
        destructive: action === 'cancel',
      });
      if (!agreed) return;
    }
    onAction(row, action, NEEDS_NOTE.has(action) ? note.trim() || undefined : undefined);
    setNoteFor(null);
    setNote('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {milestones.map((row) => (
        <div key={row.id} style={{ ...card, background: 'var(--bg-elevated)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0, flex: '1 1 200px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)' }}>{row.title}</span>
                <StatusPill status={row.status} />
              </div>
              {showContext && (row.engagementTitle || row.clientName) && (
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', marginTop: 2 }}>
                  {[row.engagementTitle, row.clientName].filter(Boolean).join(' · ')}
                </div>
              )}
              {row.description && (
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginTop: 4 }}>{row.description}</div>
              )}
              {row.dueAt && (
                <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 4 }}>
                  {t('dueBy', { date: new Date(row.dueAt).toLocaleDateString() })}
                </div>
              )}
              {row.rejectionReason && (
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--error)', marginTop: 4 }}>
                  {t('rejectedBecause', { reason: row.rejectionReason })}
                </div>
              )}
              {row.submissionNote && (
                <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {t('submittedWith', { note: row.submissionNote })}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--font-size-body)', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                {money(row.amountCents, row.currency)}
              </span>
              {(row.actions ?? []).map((action) => (
                <button key={action} type="button" disabled={busy === `${row.id}:${action}`}
                  onClick={() => void run(row, action)}
                  style={btn(action === 'cancel' ? 'danger' : action === 'reject' ? 'ghost' : 'primary')}>
                  {busy === `${row.id}:${action}` ? t('working') : t(`action.${action}`)}
                </button>
              ))}
              {onRemove && !isTransacted(row.status) && (
                <button type="button" style={btn('ghost')} disabled={busy === `${row.id}:remove`}
                  onClick={() => onRemove(row)}>{t('remove')}</button>
              )}
            </div>
          </div>
          {noteFor?.id === row.id && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input style={{ ...input, flex: '1 1 200px' }} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder={t(`notePlaceholder.${noteFor.action}`)} />
              <button type="button" style={btn('primary')} onClick={() => void run(row, noteFor.action)}>
                {t(`action.${noteFor.action}`)}
              </button>
              <button type="button" style={btn('ghost')} onClick={() => setNoteFor(null)}>{t('cancelNote')}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Author a schedule, line by line.
 *
 * Shared by the employer (on a posting or an engagement) and the freelancer (on a bid),
 * because "what are the deliverables and what is each worth" is the same question from
 * both ends — and a second editor would be a second place for the money rules to drift.
 * Kept CONTROLLED so the bid form can submit the lines with the bid in one request
 * rather than writing them one at a time before the proposal exists.
 */
export function MilestoneLinesEditor({
  lines, onChange, currency = 'USD', max = 20,
}: {
  lines: MilestoneDraft[];
  onChange: (next: MilestoneDraft[]) => void;
  currency?: string;
  max?: number;
}) {
  const t = useTranslations('milestones');
  const total = useMemo(() => lines.reduce((sum, line) => sum + (line.amountCents || 0), 0), [lines]);

  const patch = (index: number, next: Partial<MilestoneDraft>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...next } : line)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {lines.map((line, index) => (
        <div key={index} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) auto', alignItems: 'center' }}>
          <input style={input} placeholder={t('editor.titlePlaceholder')} value={line.title}
            onChange={(e) => patch(index, { title: e.target.value })} />
          <input style={input} type="number" min={0} step="0.01" placeholder={t('editor.amountPlaceholder')}
            value={line.amountCents ? (line.amountCents / 100).toString() : ''}
            onChange={(e) => patch(index, { amountCents: Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)) })} />
          <button type="button" style={btn('ghost')} aria-label={t('editor.removeLine')}
            onClick={() => onChange(lines.filter((_, i) => i !== index))}>×</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={btn('ghost')} disabled={lines.length >= max}
          onClick={() => onChange([...lines, { title: '', amountCents: 0 }])}>
          {t('editor.addLine')}
        </button>
        {lines.length > 0 && (
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
            {t('editor.total', { amount: money(total, currency) })}
          </span>
        )}
      </div>
    </div>
  );
}

/** A schedule nobody can act on here — the posting's published terms, or a rival's
 *  counter-offer as the employer reads it before deciding. */
export function MilestoneLinesPreview({ milestones, emptyLabel }: { milestones: MilestoneRow[]; emptyLabel?: string }) {
  const t = useTranslations('milestones');
  const total = milestones.reduce((sum, row) => sum + row.amountCents, 0);
  if (milestones.length === 0) {
    return emptyLabel ? <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{emptyLabel}</div> : null;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {milestones.map((row, index) => (
        <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 'var(--font-size-small)' }}>
          <span style={{ color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {index + 1}. {row.title}
          </span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{money(row.amountCents, row.currency)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 'var(--font-size-small)', borderTop: '1px solid var(--border-subtle)', paddingTop: 4 }}>
        <span style={{ color: 'var(--text-muted)' }}>{t('editor.totalLabel')}</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{money(total, milestones[0]?.currency)}</span>
      </div>
    </div>
  );
}

/** The shared load/act/error shell both panels sit in — one place that knows a failed
 *  move must re-read rather than guess what the server did. */
function useSchedule<T>(read: () => Promise<T>) {
  const t = useTranslations('milestones');
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await read()); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : t('loadFailed')); }
    finally { setLoading(false); }
    // `read` is in the deps rather than suppressed: every caller passes a
    // useCallback-stabilised reader keyed on the id it closes over, so this reloads when
    // the id changes and never on a plain re-render. Suppressing it instead would leave a
    // panel showing the previous engagement's schedule after a switch.
  }, [read, t]);

  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : t('actionFailed')); }
    finally { setBusy(null); }
  };

  return { data, loading, busy, error, act, reload: load };
}

/**
 * THE CLIENT'S PANEL — one engagement's schedule, its escrow balance, and the moves the
 * employer may make on it.
 */
export function MilestoneSchedulePanel({ engagementId }: { engagementId: string }) {
  const t = useTranslations('milestones');
  const confirm = useConfirm();
  const { data, loading, busy, error, act } = useSchedule(useCallback(() => getEngagementSchedule(engagementId), [engagementId]));
  const [draft, setDraft] = useState<MilestoneDraft>({ title: '', amountCents: 0 });

  const currency = data?.milestones[0]?.currency ?? 'USD';

  if (loading && !data) return <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loading')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div style={{ ...card, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</div>}
      {data && <EscrowSummaryTiles summary={data.summary} currency={currency} />}
      {data && <GateBanner gate={data.gate} />}

      {data && data.milestones.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('empty.client')}</div>
      )}

      {data && data.milestones.length > 0 && (
        <MilestoneRows
          milestones={data.milestones}
          busy={busy}
          onAction={(row, action, note) => void act(`${row.id}:${action}`, () => runMilestoneAction(row.id, action, note))}
          onRemove={(row) => void (async () => {
            if (!(await confirm({ message: t('confirm.remove'), destructive: true }))) return;
            await act(`${row.id}:remove`, () => deleteMilestone(row.id));
          })()}
        />
      )}

      {/* Add a deliverable. Always lands in `draft` — writing a milestone down never
          funds it, which is the property the whole machine rests on. */}
      <div style={{ ...card, display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) auto', alignItems: 'center' }}>
        <input style={input} placeholder={t('editor.titlePlaceholder')} value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
        <input style={input} type="number" min={0} step="0.01" placeholder={t('editor.amountPlaceholder')}
          value={draft.amountCents ? (draft.amountCents / 100).toString() : ''}
          onChange={(e) => setDraft((d) => ({ ...d, amountCents: Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)) }))} />
        <button type="button" style={btn('primary')} disabled={!draft.title.trim() || busy === 'add'}
          onClick={() => void act('add', async () => {
            await addEngagementMilestone(engagementId, draft);
            setDraft({ title: '', amountCents: 0 });
          })}>
          {t('editor.add')}
        </button>
      </div>
    </div>
  );
}

/**
 * THE EMPLOYER'S PANEL ON A POSTING — the schedule a bid is made against.
 *
 * No escrow actions: a job-level milestone has no engagement and therefore no
 * counterparty, so there is nothing to fund, submit or release yet. It authors drafts,
 * and accepting a proposal is what turns them into an agreement.
 */
export function JobSchedulePanel({ jobId }: { jobId: string }) {
  const t = useTranslations('milestones');
  const confirm = useConfirm();
  const { data, loading, busy, error, act } = useSchedule(useCallback(() => getJobSchedule(jobId), [jobId]));
  const [draft, setDraft] = useState<MilestoneDraft>({ title: '', amountCents: 0 });

  if (loading && !data) return <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loading')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('posting.explainer')}</p>
      {error && <div style={{ ...card, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</div>}
      {data && data.milestones.length === 0 && (
        <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('empty.posting')}</div>
      )}
      {data && data.milestones.length > 0 && (
        <MilestoneRows
          milestones={data.milestones}
          busy={busy}
          onAction={(row, action, note) => void act(`${row.id}:${action}`, () => runMilestoneAction(row.id, action, note))}
          onRemove={(row) => void (async () => {
            if (!(await confirm({ message: t('confirm.remove'), destructive: true }))) return;
            await act(`${row.id}:remove`, () => deleteMilestone(row.id));
          })()}
        />
      )}
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) auto', alignItems: 'center' }}>
        <input style={input} placeholder={t('editor.titlePlaceholder')} value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
        <input style={input} type="number" min={0} step="0.01" placeholder={t('editor.amountPlaceholder')}
          value={draft.amountCents ? (draft.amountCents / 100).toString() : ''}
          onChange={(e) => setDraft((d) => ({ ...d, amountCents: Math.max(0, Math.round(parseFloat(e.target.value || '0') * 100)) }))} />
        <button type="button" style={btn('primary')} disabled={!draft.title.trim() || busy === 'add'}
          onClick={() => void act('add', async () => {
            await addJobMilestone(jobId, draft);
            setDraft({ title: '', amountCents: 0 });
          })}>
          {t('editor.add')}
        </button>
      </div>
    </div>
  );
}

/**
 * THE FREELANCER'S PANEL — every milestone they are engaged on, and the one move that
 * is theirs to make.
 *
 * Deliberately shows every state including `draft`: a milestone nobody has funded is
 * exactly what the worker needs to see BEFORE starting, and hiding it would leave them
 * looking at an empty list on an engagement that has a schedule.
 */
export function MyMilestonesPanel() {
  const t = useTranslations('milestones');
  const { data, loading, busy, error, act } = useSchedule(useCallback(() => listMyMilestones(), []));

  if (loading && !data) return <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loading')}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div style={{ ...card, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</div>}
      {data && <EscrowSummaryTiles summary={data.summary} currency={data.milestones[0]?.currency ?? 'USD'} />}
      {data && data.milestones.length === 0
        ? <div style={{ ...card, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('empty.worker')}</div>
        : data && (
          <MilestoneRows
            milestones={data.milestones}
            busy={busy}
            showContext
            onAction={(row, action, note) => void act(`${row.id}:${action}`, () => runMilestoneAction(row.id, action, note))}
          />
        )}
    </div>
  );
}
