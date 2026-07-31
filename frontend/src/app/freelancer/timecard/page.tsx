'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { Select } from '@/components/Select';
import {
  listMyEngagements, listMyTimecards, resolveTimecard, submitTimecard, getTodayActivity,
  listTimecardEntries, addTimecardEntry, updateTimecardEntry, deleteTimecardEntry, logMeeting,
  type Engagement, type Timecard, type TimecardEntry,
} from '@/lib/freelancerApi';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18,
};

/** Current week's Mon–Sun as ISO dates (UTC). */
function currentWeek(): { start: string; end: string } {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // 0 = Monday
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

const fmtHrs = (min: number) => `${(min / 60).toFixed(1)}h`;
const money = (cents: number, cur: string) => `${cur} ${(cents / 100).toFixed(2)}`;

export default function FreelancerTimecardPage() {
  const t = useTranslations('freelancer');
  const [today, setToday] = useState<{ signalCount: number; minutes: number; byKind: Record<string, number> } | null>(null);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [cards, setCards] = useState<Timecard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [cardEntries, setCardEntries] = useState<Record<string, TimecardEntry[]>>({});
  const [newEntry, setNewEntry] = useState<{ minutes: string; description: string }>({ minutes: '', description: '' });
  const [meeting, setMeeting] = useState<{ engagementId: string; minutes: string; note: string }>({ engagementId: '', minutes: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [act, engs, tcs] = await Promise.all([
        getTodayActivity().catch(() => null),
        listMyEngagements().catch(() => []),
        listMyTimecards().catch(() => []),
      ]);
      setToday(act);
      setEngagements(engs.filter((e) => e.status === 'active'));
      setCards(tcs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resolveWeek = async (engagementId: string) => {
    setBusy(engagementId); setError(null);
    try {
      const { start, end } = currentWeek();
      await resolveTimecard({ engagementId, periodStart: start, periodEnd: end });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve');
    } finally {
      setBusy(null);
    }
  };

  const submit = async (id: string) => {
    setBusy(id); setError(null);
    try { await submitTimecard(id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to submit'); }
    finally { setBusy(null); }
  };

  const toggleEntries = async (id: string) => {
    if (openCard === id) { setOpenCard(null); return; }
    setOpenCard(id);
    if (!cardEntries[id]) {
      try { const rows = await listTimecardEntries(id); setCardEntries((p) => ({ ...p, [id]: rows })); }
      catch { /* leave empty */ }
    }
  };

  const refreshEntries = async (id: string) => {
    try { const rows = await listTimecardEntries(id); setCardEntries((p) => ({ ...p, [id]: rows })); } catch { /* noop */ }
    await load();
  };

  const addEntry = async (id: string) => {
    const minutes = Math.round(parseFloat(newEntry.minutes || '0'));
    if (!minutes || minutes <= 0) return;
    setBusy(`add:${id}`); setError(null);
    try { await addTimecardEntry(id, { minutes, description: newEntry.description || undefined }); setNewEntry({ minutes: '', description: '' }); await refreshEntries(id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  const toggleBillable = async (id: string, entry: TimecardEntry) => {
    setBusy(`e:${entry.id}`);
    try { await updateTimecardEntry(id, entry.id, { billable: !entry.billable }); await refreshEntries(id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  const removeEntry = async (id: string, entryId: string) => {
    setBusy(`e:${entryId}`);
    try { await deleteTimecardEntry(id, entryId); await refreshEntries(id); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  const submitMeeting = async () => {
    const minutes = Math.round(parseFloat(meeting.minutes || '0'));
    if (!meeting.engagementId || !minutes || minutes <= 0) return;
    setBusy('meeting'); setError(null);
    try { await logMeeting({ engagementId: meeting.engagementId, durationMinutes: minutes, note: meeting.note || undefined }); setMeeting({ engagementId: '', minutes: '', note: '' }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(null); }
  };

  const inputSm: React.CSSProperties = { background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '7px 10px', fontSize: 13, outline: 'none' };

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('timecard.title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('timecard.subtitle')}</p>
      </div>

      {error && <div style={{ ...card, color: 'var(--coral-bright)', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* Today — "what did you do today" */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('timecard.today')}</div>
        {today ? (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline', marginTop: 8 }}>
            <div><span style={{ fontSize: 26, fontWeight: 800, color: 'var(--coral-bright)' }}>{fmtHrs(today.minutes)}</span> <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('timecard.active')}</span></div>
            <div><span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>{today.signalCount}</span> <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('timecard.actions')}</span></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.entries(today.byKind).slice(0, 8).map(([k, n]) => (
                <span key={k} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{k} · {n}</span>
              ))}
            </div>
          </div>
        ) : <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 0' }}>{t('timecard.noActivity')}</p>}
      </div>

      {/* Resolve this week per active engagement */}
      {engagements.length > 0 && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('timecard.thisWeek')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {engagements.map((e) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{e.tenantName ?? t('gigs.workspace')}</span>
                <button type="button" onClick={() => resolveWeek(e.id)} disabled={busy === e.id}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  {busy === e.id ? t('timecard.resolving') : t('timecard.resolveWeek')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Log a meeting as paid time */}
      {engagements.length > 0 && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{t('meeting.title')}</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px' }}>{t('meeting.subtitle')}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Select style={{ ...inputSm, minWidth: 160 }} value={meeting.engagementId} onChange={(e) => setMeeting((m) => ({ ...m, engagementId: e.target.value }))}>
              <option value="">{t('meeting.selectWorkspace')}</option>
              {engagements.map((e) => <option key={e.id} value={e.id}>{e.tenantName ?? t('gigs.workspace')}</option>)}
            </Select>
            <input style={{ ...inputSm, width: 110 }} type="number" min={1} placeholder={t('meeting.minutes')} value={meeting.minutes} onChange={(e) => setMeeting((m) => ({ ...m, minutes: e.target.value }))} />
            <input style={{ ...inputSm, flex: 1, minWidth: 140 }} placeholder={t('meeting.note')} value={meeting.note} onChange={(e) => setMeeting((m) => ({ ...m, note: e.target.value }))} />
            <button type="button" onClick={submitMeeting} disabled={busy === 'meeting' || !meeting.engagementId || !meeting.minutes}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (!meeting.engagementId || !meeting.minutes) ? 0.5 : 1 }}>
              {busy === 'meeting' ? t('saving') : t('meeting.log')}
            </button>
          </div>
        </div>
      )}

      {/* Timecards */}
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{t('timecard.history')}</div>
      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('loading')}</p>
      ) : cards.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 14 }}>{t('timecard.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cards.map((c) => (
            <div key={c.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{c.tenantName ?? ''} · {c.periodStart} – {c.periodEnd}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                    {fmtHrs(c.billableMinutes)} {t('timecard.billable')} · {money(c.amountCents, c.currency)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>{t(`timecard.status.${c.status}`)}</span>
                  {c.status === 'draft' && (
                    <>
                      <button type="button" onClick={() => toggleEntries(c.id)}
                        style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        {openCard === c.id ? t('entries.hide') : t('entries.edit')}
                      </button>
                      <button type="button" onClick={() => submit(c.id)} disabled={busy === c.id}
                        style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                        {busy === c.id ? t('saving') : t('timecard.submit')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Editable entries (draft only) */}
              {openCard === c.id && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(cardEntries[c.id] ?? []).length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('entries.none')}</div>}
                  {(cardEntries[c.id] ?? []).map((en) => (
                    <div key={en.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{en.workDate} · {t(`entries.source.${en.source}`)}{en.description ? ` · ${en.description}` : ''}</span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{fmtHrs(en.minutes)}</span>
                      <button type="button" onClick={() => toggleBillable(c.id, en)} disabled={busy === `e:${en.id}`}
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: en.billable ? 'var(--surface-coral-soft)' : 'var(--bg-elevated)', color: en.billable ? 'var(--coral-bright)' : 'var(--text-muted)' }}>
                        {en.billable ? t('entries.billable') : t('entries.nonBillable')}
                      </button>
                      <button type="button" onClick={() => removeEntry(c.id, en.id)} disabled={busy === `e:${en.id}`}
                        aria-label={t('entries.remove')} style={{ fontSize: 13, padding: '2px 7px', borderRadius: 6, cursor: 'pointer', border: '1px solid rgba(239,68,68,0.4)', background: 'var(--bg-elevated)', color: '#f87171' }}>✕</button>
                    </div>
                  ))}
                  {/* Add manual entry */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <input style={{ ...inputSm, width: 110 }} type="number" min={1} placeholder={t('meeting.minutes')} value={newEntry.minutes} onChange={(e) => setNewEntry((n) => ({ ...n, minutes: e.target.value }))} />
                    <input style={{ ...inputSm, flex: 1, minWidth: 140 }} placeholder={t('entries.descPlaceholder')} value={newEntry.description} onChange={(e) => setNewEntry((n) => ({ ...n, description: e.target.value }))} />
                    <button type="button" onClick={() => addEntry(c.id)} disabled={busy === `add:${c.id}` || !newEntry.minutes}
                      style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {t('entries.add')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
