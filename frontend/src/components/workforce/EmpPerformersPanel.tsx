import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  empMetricsApi,
  type CoachingNote,
  type PerformerRow,
  type PerformerTier,
  type PerformerTiersResult,
} from '@/lib/builderforceApi';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { useFormat } from '@/i18n/useFormat';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { TIER_COLOR, empMemberSearch, usePerformersDescriptor, useTierLabel } from './empMetricsCollections';

/**
 * EMP-16 — performer tiers + coaching notes. The tier list renders through the
 * ONE Collection; the coaching-notes editor for the member whose "add note"
 * control is open sits under the collection (a table cannot expand a row).
 */

const DANGER = 'var(--danger)';

function CoachingNotes({ member }: { member: PerformerRow }) {
  const fmt = useFormat();
  const t = useTranslations('components');
  const [notes, setNotes] = useState<CoachingNote[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = () => empMetricsApi.coachingNotes(member.memberKind, member.memberRef).then((r) => setNotes(r.notes)).catch(() => setNotes([]));
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [member.memberKind, member.memberRef]);

  const save = async () => {
    const note = draft.trim();
    if (!note) return;
    setBusy(true);
    try { await empMetricsApi.addCoachingNote(member.memberKind, member.memberRef, note); setDraft(''); await reload(); }
    finally { setBusy(false); }
  };
  const remove = async (id: number) => { await empMetricsApi.deleteCoachingNote(id); await reload(); };

  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', marginTop: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>{member.name}</div>
      {notes == null ? (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.loading')}</div>
      ) : notes.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('emp.noNotes')}</div>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {notes.map((n) => (
            <li key={n.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{n.note}</span>
              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt.date(n.createdAt)}</span>
              <button onClick={() => remove(n.id)} style={{ background: 'none', border: 'none', color: DANGER, cursor: 'pointer', fontSize: 11 }}>{t('emp.deleteNote')}</button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder={t('emp.notePlaceholder')}
          style={{ flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 'var(--radius-md)', fontSize: 12, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
        />
        <button onClick={save} disabled={busy || !draft.trim()} style={{ padding: '6px 12px', borderRadius: 'var(--radius-md)', fontSize: 12, cursor: 'pointer', border: '1px solid var(--border-subtle)', background: 'var(--accent)', color: 'var(--text-on-accent)', opacity: busy || !draft.trim() ? 0.6 : 1 }}>
          {t('emp.saveNote')}
        </button>
      </div>
    </div>
  );
}

export function PerformersPanel({ days, cardStyle }: { days: number; cardStyle: React.CSSProperties }) {
  const errorMessage = useErrorMessage();
  const t = useTranslations('components');
  const tierLabel = useTierLabel();
  const [data, setData] = useState<PerformerTiersResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { empMetricsApi.performerTiers(days).then(setData).catch((e: unknown) => setErr(errorMessage(e))); }, [days, errorMessage]);

  const toggle = useCallback((key: string) => setOpen((cur) => (cur === key ? null : key)), []);
  const descriptor = usePerformersDescriptor(open, toggle);
  const openMember = open ? data?.members.find((m) => `${m.memberKind}:${m.memberRef}` === open) ?? null : null;

  return (
    <div style={cardStyle}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{t('emp.performersTitle')}</div>
      {err && <div style={{ color: DANGER, fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {data == null ? (
        !err && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('emp.loading')}</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {(['high', 'solid', 'watch'] as PerformerTier[]).map((tier) => (
              <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 12, border: '1px solid var(--border-subtle)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 'var(--radius-full)', background: TIER_COLOR[tier] }} />
                <span style={{ fontWeight: 600 }}>{tierLabel(tier)}</span>
                <span style={{ color: 'var(--muted)' }}>{data.counts[tier]}</span>
              </div>
            ))}
          </div>
          <LocalCollection descriptor={descriptor} rows={data.members} searchText={empMemberSearch} />
          {openMember && <CoachingNotes member={openMember} />}
        </>
      )}
    </div>
  );
}
