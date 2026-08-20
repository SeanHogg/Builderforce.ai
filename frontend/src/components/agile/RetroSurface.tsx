'use client';

import { Select } from '@/components/Select';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { retroApi, isCeremonySessionDone, type Retrospective, type RetroDetail } from '@/lib/builderforceApi';
import { useRealtimeRoom } from '@/lib/embed/useRealtimeRoom';

/**
 * Retrospectives surface. Retro → columns (by template) → items with upvotes, live
 * over the session WebSocket. Rendered both as the `/embed/retros` view and as the
 * Retro sub-view of the Ceremonies tab.
 *
 * A retro is TEAM WORK with an end, so it can be closed here — `retrospectives.status`
 * used to be written once at insert and never again, which left every retro in every
 * workspace permanently `active` and made "is this one finished?" unanswerable.
 */

/**
 * Template → its column KEYS.
 *
 * These strings are also the persisted `retro_items.category` value, so they are
 * STABLE IDENTIFIERS, not display copy — translating them in place would orphan every
 * item already stored. The visible heading comes from `retroColumn.<key>` instead, with
 * the key itself as the fallback for a template a catalog has not caught up with.
 */
const TEMPLATES: Record<string, string[]> = {
  start_stop_continue: ['Start', 'Stop', 'Continue'],
  mad_sad_glad: ['Mad', 'Sad', 'Glad'],
  four_ls: ['Liked', 'Learned', 'Lacked', 'Longed for'],
  what_went_well: ['Went well', 'To improve', 'Action items'],
};
const TEMPLATE_OPTIONS = Object.keys(TEMPLATES);

export function RetroSurface({ initialRetroId }: { initialRetroId?: string | null }) {
  const t = useTranslations('agile');
  const [retros, setRetros] = useState<Retrospective[]>([]);
  const [selected, setSelected] = useState<string | null>(initialRetroId ?? null);
  const [detail, setDetail] = useState<RetroDetail | null>(null);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('start_stop_continue');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // A deep link (a linked chat's "open") names the retro — follow it when it changes.
  useEffect(() => { if (initialRetroId) setSelected(initialRetroId); }, [initialRetroId]);

  const loadRetros = useCallback(() => {
    retroApi.list().then(setRetros).catch(() => setError(t('retroLoadFailed')));
  }, [t]);
  useEffect(loadRetros, [loadRetros]);

  const refresh = useCallback(() => {
    if (selected) retroApi.get(selected).then(setDetail).catch(() => {});
  }, [selected]);

  // Initial load on open + live updates over WebSocket (no polling).
  useEffect(() => { if (!selected) setDetail(null); else refresh(); }, [selected, refresh]);
  useRealtimeRoom(selected ? `/api/agile/retros/${selected}/ws` : null, refresh);

  const createRetro = async () => {
    if (!name.trim()) return;
    try { const r = await retroApi.create(name.trim(), template); setName(''); loadRetros(); setSelected(r.id); }
    catch { setError(t('createFailedManager')); }
  };

  const addItem = async (category: string) => {
    const content = (drafts[category] ?? '').trim();
    if (!selected || !content) return;
    try { await retroApi.addItem(selected, category, content); setDrafts((d) => ({ ...d, [category]: '' })); refresh(); }
    catch { setError(t('addFailed')); }
  };

  const upvote = (id: string) => retroApi.voteItem(id).then(refresh).catch(() => {});

  /** Close a held retro, or re-open one closed by mistake. Manager-only server-side;
   *  a member's attempt surfaces the same explained failure as every other write. */
  const toggleClosed = async () => {
    if (!selected || !detail || closing) return;
    setClosing(true);
    try {
      await retroApi.setStatus(selected, isCeremonySessionDone(detail.status) ? 'active' : 'completed');
      refresh();
      loadRetros();
    } catch { setError(t('statusFailedManager')); }
    finally { setClosing(false); }
  };

  /** Localized heading for a stored column key (see {@link TEMPLATES}). */
  const columnLabel = (key: string) => t.has(`retroColumn.${key}`) ? t(`retroColumn.${key}`) : key;
  const templateLabel = (key: string) => t.has(`retroTemplate.${key}`) ? t(`retroTemplate.${key}`) : key.replace(/_/g, ' ');
  const statusLabel = (s: string) => t.has(`ceremonyStatus.${s}`) ? t(`ceremonyStatus.${s}`) : s;

  if (!selected) {
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('retrosTitle')}</div>
        {error && <div role="alert" style={{ color: 'var(--error-text)', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('retroNamePlaceholder')} aria-label={t('retroNamePlaceholder')} style={inp} />
          <Select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label={t('retroTemplateLabel')} style={{ ...inp, flex: '0 0 auto' }}>
            {TEMPLATE_OPTIONS.map((k) => <option key={k} value={k}>{templateLabel(k)}</option>)}
          </Select>
          <button onClick={createRetro} style={btn}>{t('create')}</button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {retros.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} style={row}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{templateLabel(r.template)} · {statusLabel(r.status)}</span>
            </button>
          ))}
          {retros.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>{t('noRetros')}</div>}
        </div>
      </div>
    );
  }

  const columns = TEMPLATES[detail?.template ?? 'start_stop_continue'] ?? ['Notes'];
  const closed = isCeremonySessionDone(detail?.status);

  return (
    <div>
      <button onClick={() => setSelected(null)} style={link}>← {t('retrosTitle')}</button>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '8px 0' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{detail?.name ?? t('loading')}</div>
        {detail && <span style={statusChip}>{statusLabel(detail.status)}</span>}
        {detail && (
          <button onClick={toggleClosed} disabled={closing} style={{ ...secondaryBtn, marginLeft: 'auto' }}>
            {closing ? t('saving') : closed ? t('reopenCeremony') : t('closeCeremony')}
          </button>
        )}
      </div>
      {error && <div role="alert" style={{ color: 'var(--error-text)', marginBottom: 8 }}>{error}</div>}
      {/* auto-fit so four columns become two (then one) on a narrow viewport rather
          than overflowing it. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {columns.map((col) => {
          const items = (detail?.items ?? []).filter((i) => i.category === col).sort((a, b) => b.votes - a.votes);
          return (
            <div key={col} style={colStyle}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{columnLabel(col)}</div>
              {!closed && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input value={drafts[col] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [col]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && addItem(col)} placeholder={t('addItemPlaceholder')}
                    aria-label={t('addItemTo', { column: columnLabel(col) })} style={{ ...inp, fontSize: 12 }} />
                  <button onClick={() => addItem(col)} aria-label={t('addItemTo', { column: columnLabel(col) })} style={{ ...btn, padding: '4px 10px' }}>+</button>
                </div>
              )}
              <div style={{ display: 'grid', gap: 6 }}>
                {items.map((it) => (
                  <div key={it.id} style={itemStyle}>
                    <span style={{ flex: 1 }}>{it.content}</span>
                    <button onClick={() => upvote(it.id)} disabled={closed} aria-label={t('upvote')} style={voteBtn}>▲ {it.votes}</button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { fontSize: 13, padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', flex: 1, minWidth: 0 };
const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' };
const secondaryBtn: React.CSSProperties = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer' };
const statusChip: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' };
const link: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0 };
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '8px 12px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-base)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left' };
const colStyle: React.CSSProperties = { border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--bg-base)', minWidth: 0 };
const itemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };
const voteBtn: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' };
