'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TenantMember } from '@/lib/auth';
import { contributorsApi, type ContributorRow } from '@/lib/builderforceApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ContributorConsolidation } from './ContributorConsolidation';

/**
 * Consolidate the people selected (by checkbox) in the Workforce directory list.
 * Each selected member is matched to its activity contributor profile (by linked
 * workspace user); the admin picks who to keep and the rest merge into them in
 * one pass. Reversible (every merge is logged on the full consolidation tools
 * embedded below). MANAGER+ — the entry point is gated by the directory.
 *
 * This is the relocated home of contributor consolidation: the selection-driven
 * merge up top, and the complete toolset (suggested duplicates, manual merge,
 * link-to-user, history) underneath so nothing was lost when it left the old
 * Contributors tab.
 */

const sectionStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};
const btn = (primary = false): React.CSSProperties => ({
  fontSize: 13, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border-subtle)',
  background: primary ? 'var(--accent, #6366f1)' : 'var(--bg-base)',
  color: primary ? '#fff' : 'var(--text-secondary)',
});

export function MemberConsolidationPanel({
  open,
  onClose,
  members,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  members: TenantMember[];
  onMerged?: () => void;
}) {
  const t = useTranslations('workforce.consolidate');
  const [contributors, setContributors] = useState<ContributorRow[] | null>(null);
  const [survivorId, setSurvivorId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ merged: number; moved: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    setError(null);
    contributorsApi.list()
      .then((r) => setContributors(r.contributors.filter((c) => c.kind === 'human')))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => { if (open) { load(); setResult(null); } }, [open, load, reloadKey]);

  // Map each selected member → its contributor profile (linked by workspace user).
  const byUser = useMemo(
    () => new Map((contributors ?? []).filter((c) => c.userId).map((c) => [c.userId as string, c])),
    [contributors],
  );
  const matched = useMemo(
    () => members.map((m) => ({ member: m, contributor: byUser.get(m.id) ?? null })),
    [members, byUser],
  );
  const matchedContributors = matched.filter((x) => x.contributor) as Array<{ member: TenantMember; contributor: ContributorRow }>;
  const unmatched = matched.filter((x) => !x.contributor);

  // Default the survivor to the first matched profile once data loads.
  useEffect(() => {
    if (survivorId == null && matchedContributors.length > 0) setSurvivorId(matchedContributors[0].contributor.id);
  }, [matchedContributors, survivorId]);

  const doMerge = async () => {
    if (survivorId == null) return;
    const sources = matchedContributors.filter((x) => x.contributor.id !== survivorId);
    if (sources.length === 0) { setError(t('needTwo')); return; }
    setBusy(true); setError(null);
    let merged = 0; let moved = 0;
    try {
      // Sequential — each merge re-attributes activity to the survivor.
      for (const s of sources) {
        const r = await contributorsApi.merge(s.contributor.id, survivorId);
        merged += 1; moved += r.movedActivityCount;
      }
      setResult({ merged, moved });
      onMerged?.();
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('mergeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const survivorName = matchedContributors.find((x) => x.contributor.id === survivorId)?.contributor.displayName ?? '';

  return (
    <SlideOutPanel open={open} onClose={onClose} title={t('title')}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && <div style={{ ...sectionStyle, borderColor: 'var(--danger, #e5484d)', color: 'var(--danger, #e5484d)' }}>{error}</div>}

        {/* Selected-member merge */}
        <div style={sectionStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{t('selectedTitle', { count: members.length })}</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('selectedSub')}</p>

          {contributors == null ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
          ) : matchedContributors.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('noneMatched')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {matchedContributors.map(({ member, contributor }) => (
                <label key={contributor.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="survivor"
                    checked={survivorId === contributor.id}
                    onChange={() => setSurvivorId(contributor.id)}
                    disabled={busy}
                  />
                  <span style={{ fontWeight: 600 }}>{member.displayName ?? member.email}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{contributor.displayName}{contributor.userId ? ' 🔗' : ''}</span>
                  {survivorId === contributor.id && <span style={{ fontSize: 11, color: 'var(--accent, #6366f1)' }}>{t('keep')}</span>}
                </label>
              ))}
            </div>
          )}

          {unmatched.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              {t('unmatched', { names: unmatched.map((x) => x.member.displayName ?? x.member.email).join(', ') })}
            </div>
          )}

          {result ? (
            <div style={{ fontSize: 13, color: 'var(--success, #30a46c)', marginTop: 12 }}>
              {t('done', { merged: result.merged, moved: result.moved })}
            </div>
          ) : (
            matchedContributors.length >= 2 && (
              <div style={{ marginTop: 14 }}>
                <button disabled={busy || survivorId == null} onClick={doMerge} style={btn(true)}>
                  {busy ? t('merging') : t('mergeInto', { survivor: survivorName, count: matchedContributors.length - 1 })}
                </button>
              </div>
            )
          )}
        </div>

        {/* Full consolidation toolset (relocated from the Contributors tab). */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>{t('toolsTitle')}</h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('toolsSub')}</p>
          <ContributorConsolidation key={reloadKey} />
        </div>
      </div>
    </SlideOutPanel>
  );
}
