'use client';

/**
 * Freelancer "My Workspace" — where a hired worker actually delivers. Lists the
 * engagements they've been given board access to (listEngagementBoard), lets them
 * open one to see its project tasks (listEngagementTasks), request a review on a
 * task, and present a proposal/deliverable against it (submitDeliverable). Their
 * submitted deliverables show their AI evaluation score chip + status. Web-JWT
 * surface — theme-safe (CSS variables only) and fluid to 360px.
 */
import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import NotificationsPanel from '@/components/freelance/NotificationsPanel';
import {
  listEngagementBoard, listEngagementTasks, requestReview, submitDeliverable, listMyDeliverables,
  type EngagementBoard, type EngagementTask, type Deliverable,
} from '@/lib/freelancerApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18,
};
const input: React.CSSProperties = {
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)',
  borderRadius: 8, padding: '7px 10px', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const primaryBtn: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
  color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
  color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

/** AI eval headline (0..100) chip — translucent bg + saturated text, both themes. */
function ScoreChip({ score }: { score: number }) {
  const hue = score >= 75 ? '34,197,94' : score >= 50 ? '245,158,11' : '239,68,68';
  const fg = score >= 75 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#f87171';
  return <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 6, background: `rgba(${hue},0.16)`, color: fg, flexShrink: 0 }}>{Math.round(score)}</span>;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  submitted: { bg: 'rgba(59,130,246,0.12)', fg: 'rgba(59,130,246,0.95)' },
  in_review: { bg: 'rgba(245,158,11,0.14)', fg: 'var(--warning-fg, #f59e0b)' },
  accepted: { bg: 'rgba(34,197,94,0.14)', fg: 'rgba(34,197,94,0.95)' },
  changes_requested: { bg: 'rgba(239,68,68,0.14)', fg: '#f87171' },
};

export default function FreelancerWorkspacePage() {
  const tg = useTranslations('gigs');
  const [boards, setBoards] = useState<EngagementBoard[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tasks, setTasks] = useState<EngagementTask[]>([]);
  const [myDeliverables, setMyDeliverables] = useState<Deliverable[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState<Record<number, boolean>>({});
  const [proposeFor, setProposeFor] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: '', body: '' });

  const loadBoards = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const rows = await listEngagementBoard();
      setBoards(rows);
      if (rows.length > 0) setSelected((s) => s ?? rows[0].engagementId);
    } catch (e) { setError(e instanceof Error ? e.message : tg('workspace.loadError')); }
    finally { setLoading(false); }
  }, [tg]);

  const loadEngagement = useCallback(async (engagementId: string) => {
    setTasksLoading(true); setError(null);
    try {
      const [ts, ds] = await Promise.all([
        listEngagementTasks(engagementId).catch(() => []),
        listMyDeliverables(engagementId).catch(() => []),
      ]);
      setTasks(ts); setMyDeliverables(ds); setReviewed({});
    } catch (e) { setError(e instanceof Error ? e.message : tg('workspace.loadError')); }
    finally { setTasksLoading(false); }
  }, [tg]);

  useEffect(() => { void loadBoards(); }, [loadBoards]);
  useEffect(() => { if (selected) void loadEngagement(selected); }, [selected, loadEngagement]);

  const doRequestReview = async (taskId: number) => {
    if (!selected) return;
    setBusy(`rev:${taskId}`); setError(null);
    try { await requestReview(selected, taskId); setReviewed((m) => ({ ...m, [taskId]: true })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  const submitProposal = async (taskId: number) => {
    if (!selected || !draft.title.trim()) return;
    setBusy(`sub:${taskId}`); setError(null);
    try {
      await submitDeliverable({ engagementId: selected, title: draft.title.trim(), body: draft.body.trim(), ticketId: taskId });
      setProposeFor(null); setDraft({ title: '', body: '' });
      const ds = await listMyDeliverables(selected).catch(() => myDeliverables);
      setMyDeliverables(ds);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  const statusPill = (s: string) => {
    const c = STATUS_COLORS[s] ?? { bg: 'var(--bg-elevated)', fg: 'var(--text-muted)' };
    return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: c.bg, color: c.fg, flexShrink: 0 }}>{tg(`deliverables.status.${s}`)}</span>;
  };

  return (
    <PageContainer width="full" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{tg('workspace.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{tg('workspace.subtitle')}</p>
      </div>

      <NotificationsPanel />

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {loading && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{tg('workspace.loading')}</p>}

      {!loading && boards.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>{tg('workspace.noEngagements')}</div>
      )}

      {!loading && boards.length > 0 && (
        <>
          {/* Engagement selector */}
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{tg('workspace.selectEngagement')}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
            {boards.map((b) => (
              <button key={b.engagementId} type="button" onClick={() => setSelected(b.engagementId)}
                style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                  background: selected === b.engagementId ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)',
                  border: `1px solid ${selected === b.engagementId ? 'var(--coral-bright)' : 'var(--border-subtle)'}`, color: 'var(--text-primary)' }}>
                <div>{b.projectName ?? b.title ?? b.tenantName ?? b.engagementId}</div>
                {b.tenantName && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{b.tenantName}</div>}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
            {/* Tasks */}
            <section>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>{tg('workspace.tasks')}</h2>
              {tasksLoading ? <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{tg('workspace.loading')}</p>
                : tasks.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 28, color: 'var(--text-muted)', fontSize: 13 }}>{tg('workspace.noTasks')}</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {tasks.map((tk) => (
                    <div key={tk.id} style={card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{tk.title}</div>
                          <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>{tk.key} · {tk.status}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" style={ghostBtn} disabled={busy === `rev:${tk.id}` || reviewed[tk.id]} onClick={() => doRequestReview(tk.id)}>
                            {reviewed[tk.id] ? tg('workspace.reviewRequested') : busy === `rev:${tk.id}` ? tg('workspace.requestingReview') : tg('workspace.requestReview')}
                          </button>
                          <button type="button" style={primaryBtn} onClick={() => { setProposeFor(proposeFor === tk.id ? null : tk.id); setDraft({ title: '', body: '' }); }}>{tg('workspace.presentProposal')}</button>
                        </div>
                      </div>
                      {tk.description && <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, maxHeight: 60, overflow: 'hidden' }}>{tk.description}</p>}
                      {proposeFor === tk.id && (
                        <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <input style={input} placeholder={tg('workspace.proposalTitle')} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
                          <textarea style={{ ...input, minHeight: 70, resize: 'vertical' }} placeholder={tg('workspace.proposalBodyPlaceholder')} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" style={primaryBtn} disabled={busy === `sub:${tk.id}` || !draft.title.trim()} onClick={() => submitProposal(tk.id)}>{busy === `sub:${tk.id}` ? tg('workspace.submitting') : tg('workspace.submit')}</button>
                            <button type="button" style={ghostBtn} onClick={() => setProposeFor(null)}>{tg('publish.cancel')}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* My deliverables */}
            <section>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>{tg('workspace.myDeliverables')}</h2>
              {myDeliverables.length === 0 ? <div style={{ ...card, textAlign: 'center', padding: 28, color: 'var(--text-muted)', fontSize: 13 }}>{tg('workspace.noDeliverables')}</div> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {myDeliverables.map((d) => (
                    <div key={d.id} style={card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{d.title}</span>
                          {d.lastEvalOverall != null && <ScoreChip score={d.lastEvalOverall} />}
                        </div>
                        {statusPill(d.status)}
                      </div>
                      {d.body && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>{d.body}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </PageContainer>
  );
}
