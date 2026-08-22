'use client';

/**
 * Which TEAMS this project's board belongs to.
 *
 * A team attachment is a membership, not a board setting — the same team is
 * attached to many projects — so it reads and writes `lib/teams` directly and
 * shares nothing with the lane machinery beside it.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import {
  listTeams,
  listTeamsByProject,
  addTeamProject,
  removeTeamProject,
  type TeamSummary,
  type AttachedTeam,
} from '@/lib/teams';
import { btnPrimary, btnSubtle, inputStyle, sectionPad } from './configStyles';

export function TeamsTab({ projectId }: { projectId: number }) {
  const t = useTranslations('boardConfig');
  const [allTeams, setAllTeams] = useState<TeamSummary[]>([]);
  const [attached, setAttached] = useState<AttachedTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [all, here] = await Promise.all([listTeams(), listTeamsByProject(projectId)]);
      setAllTeams(all);
      setAttached(here);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errLoadTeams'));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => { void load(); }, [load]);

  const attachedIds = new Set(attached.map((t) => t.id));
  const available = allTeams.filter((t) => !attachedIds.has(t.id));

  const mutate = async (fn: () =>
    Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t('errUpdate')); }
    finally { setBusy(false); }
  };

  const workforceLink = (chunks: React.ReactNode) => (
    <Link href="/workforce?tab=teams" style={{ color: 'var(--coral-bright)', fontWeight: 600 }}>{chunks}</Link>
  );

  return (
    <div style={sectionPad}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {t.rich('teamsIntro', { link: workforceLink })}
      </div>

      {error && (
        <div style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loadingTeams')}</div>
      ) : (
        <>
          {attached.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{t('noTeamsAssigned')}</div>
          ) : (
            <div style={{ marginBottom: 12 }}>
              {attached.map((tm) => (
                <div key={tm.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{tm.name}</div>
                    {tm.description && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tm.description}</div>
                    )}
                  </div>
                  <span style={{ flex: 1 }} />
                  <button type="button" style={{ ...btnSubtle, color: 'var(--danger)' }} disabled={busy} onClick={() => void mutate(() => removeTeamProject(tm.id, projectId))}>
                    {t('remove')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {allTeams.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t.rich('noTeamsExist', { link: workforceLink })}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                aria-label={t('selectTeamToAssign')}
                disabled={busy || available.length === 0}
              >
                <option value="">{available.length === 0 ? t('allTeamsAssigned') : t('assignTeam')}</option>
                {available.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
              </Select>
              <button
                type="button"
                style={{ ...btnPrimary, opacity: !pick || busy ? 0.6 : 1 }}
                disabled={!pick || busy}
                onClick={() => { const id = Number(pick); if (id) void mutate(async () => { await addTeamProject(id, projectId); setPick(''); }); }}
              >
                {t('assign')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
