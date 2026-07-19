'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  contributorsApi, tasksApi,
  type ContributorRow, type DuplicateGroup, type MergePreview, type MergeRecord,
} from '@/lib/builderforceApi';

/**
 * Contributor consolidation — merge duplicate human profiles that activity
 * ingestion created across sources, and link a profile to a Builderforce user so
 * external activity and platform engagement attach to one person. Tenant-wide and
 * reversible (every merge is logged with an Undo). MANAGER+ on the API.
 */

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};
const btn = (primary = false): React.CSSProperties => ({
  fontSize: 12, padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border-subtle)',
  background: primary ? 'var(--accent, #6366f1)' : 'var(--bg-base)',
  color: primary ? '#fff' : 'var(--text-secondary)',
});
export function ContributorConsolidation() {
  const t = useTranslations('contributorMerge');
  const tc = useTranslations('common');
  const REASON_LABEL: Record<DuplicateGroup['reason'], string> = {
    email: t('reasonEmail'), identity_email: t('reasonIdentityEmail'), name: t('reasonName'),
  };
  const [contributors, setContributors] = useState<ContributorRow[] | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [merges, setMerges] = useState<MergeRecord[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Manual merge selection.
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [targetId, setTargetId] = useState<number | ''>('');
  const [preview, setPreview] = useState<MergePreview | null>(null);

  const load = () => {
    setError(null);
    Promise.all([
      contributorsApi.list(),
      contributorsApi.duplicates(),
      contributorsApi.merges(),
      tasksApi.assignees().catch(() => []),
    ])
      .then(([c, d, m, u]) => {
        setContributors(c.contributors.filter((x) => x.kind === 'human'));
        setGroups(d.groups);
        setMerges(m.merges);
        setUsers(u);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => { load(); }, []);

  const byId = useMemo(() => new Map((contributors ?? []).map((c) => [c.id, c])), [contributors]);

  const doPreview = async (s: number, tgt: number) => {
    setError(null);
    try { setPreview(await contributorsApi.mergePreview(s, tgt)); }
    catch (e) { setError(e instanceof Error ? e.message : t('previewFailed')); }
  };

  const doMerge = async (s: number, tgt: number) => {
    setBusy(true); setError(null);
    try {
      await contributorsApi.merge(s, tgt);
      setPreview(null); setSourceId(''); setTargetId('');
      load();
    } catch (e) { setError(e instanceof Error ? e.message : t('mergeFailed')); }
    finally { setBusy(false); }
  };

  const doRevert = async (mergeId: string) => {
    setBusy(true); setError(null);
    try { await contributorsApi.revertMerge(mergeId); load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('revertFailed')); }
    finally { setBusy(false); }
  };

  const doLink = async (contributorId: number, userId: string | null) => {
    setBusy(true); setError(null);
    try { await contributorsApi.linkUser(contributorId, userId); load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('linkFailed')); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ ...cardStyle, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>}

      {/* Suggested duplicates */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{t('suggestedDuplicates')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('suggestedDuplicatesDesc')}
        </p>
        {groups.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('noDuplicates')}</div>
        ) : groups.map((g) => (
          <div key={`${g.reason}:${g.key}`} style={{ borderTop: '1px solid var(--border-subtle)', padding: '10px 0' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
              {REASON_LABEL[g.reason]}: <b>{g.key || '—'}</b>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {g.contributors.map((survivor) => (
                <button
                  key={survivor.id}
                  disabled={busy}
                  onClick={() => {
                    const others = g.contributors.filter((x) => x.id !== survivor.id);
                    if (others.length === 1) doPreview(others[0].id, survivor.id);
                  }}
                  style={{ ...btn(), textAlign: 'left' }}
                  title={t('keepThisTitle')}
                >
                  {t('keep')} <b>{survivor.displayName}</b>{survivor.userId ? ' 🔗' : ''}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Manual merge */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>{t('mergeTwoProfiles')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : '')} style={selectStyle}>
            <option value="">{t('mergeThis')}</option>
            {(contributors ?? []).map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </Select>
          <span style={{ color: 'var(--text-muted)' }}>{t('intoArrow')}</span>
          <Select value={targetId} onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : '')} style={selectStyle}>
            <option value="">{t('keepThisOption')}</option>
            {(contributors ?? []).filter((c) => c.id !== sourceId).map((c) => <option key={c.id} value={c.id}>{c.displayName}</option>)}
          </Select>
          <button
            disabled={busy || !sourceId || !targetId}
            onClick={() => sourceId && targetId && doPreview(sourceId, targetId)}
            style={btn(true)}
          >{t('preview')}</button>
        </div>
      </div>

      {/* Link contributors to Builderforce users */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{t('linkToUser')}</h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('linkToUserDesc')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(contributors ?? []).map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: '0 0 200px', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.displayName}</span>
              <Select
                value={c.userId ?? ''}
                disabled={busy}
                onChange={(e) => doLink(c.id, e.target.value || null)}
                style={selectStyle}
              >
                <option value="">{t('notLinked')}</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </div>
          ))}
        </div>
      </div>

      {/* Merge history */}
      {merges.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>{t('mergeHistory')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {merges.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>
                  {byId.get(m.sourceContributorId ?? -1)?.displayName ?? `#${m.sourceContributorId}`} → {byId.get(m.targetContributorId ?? -1)?.displayName ?? `#${m.targetContributorId}`}
                  <span style={{ color: 'var(--text-muted)' }}> · {t('eventsCount', { count: m.movedActivityCount })} · {new Date(m.mergedAt).toLocaleDateString()}</span>
                </span>
                {m.status === 'reverted'
                  ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('reverted')}</span>
                  : <button disabled={busy} onClick={() => doRevert(m.id)} style={btn()}>{t('undo')}</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Preview / confirm merge — a slide-out panel, not a modal: a merge is
          reversible and logged (Undo lives in the history above), so it isn't a
          terminal/destructive confirm. */}
      <SlideOutPanel
        open={preview != null}
        onClose={() => setPreview(null)}
        title={t('confirmMerge')}
        width="min(560px, 96vw)"
      >
        {preview && (
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, margin: 0 }}>
              {t.rich('mergeSentence', {
                source: preview.source.displayName,
                target: preview.target.displayName,
                b: (chunks) => <b>{chunks}</b>,
              })}
            </p>
            <ul style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, paddingLeft: 18 }}>
              <li>{t('activityMoved', { count: preview.movedActivityCount })}</li>
              <li>{t('identitiesMoved', { count: preview.movedIdentityCount })}{preview.dedupedIdentityCount ? `, ${t('duplicatesRemoved', { count: preview.dedupedIdentityCount })}` : ''}</li>
              <li>{t('teamMoved', { count: preview.movedTeamCount })}{preview.dedupedTeamCount ? `, ${t('duplicatesRemoved', { count: preview.dedupedTeamCount })}` : ''}</li>
              {preview.willInheritUserLink && <li>{t('inheritsUserLink')}</li>}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setPreview(null)} style={btn()}>{tc('cancel')}</button>
              <button disabled={busy} onClick={() => doMerge(preview.source.id, preview.target.id)} style={btn(true)}>
                {busy ? t('merging') : t('merge')}
              </button>
            </div>
          </div>
        )}
      </SlideOutPanel>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  fontSize: 13, padding: '5px 8px', borderRadius: 8,
  border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)',
  maxWidth: 260,
};
