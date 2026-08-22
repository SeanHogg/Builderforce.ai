'use client';

/**
 * The agents assigned to one lane — who acts when a card arrives there.
 *
 * Reads the project's agent pool itself rather than being handed one, so the row
 * can be dropped anywhere a lane is shown without its host first learning what a
 * pool is.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { LaneRunNowButton } from '../LaneRunNowButton';
import { useConfirm } from '@/components/ConfirmProvider';
import { boardsApi, type Board, type Swimlane, type SwimlaneAgent } from '@/lib/builderforceApi';
import { loadProjectAgentPool, type PoolAgent } from '@/lib/agentPool';
import { btnPrimary, btnSubtle, inputStyle } from './configStyles';

export function LaneAgentList({ board, lane, agents, reload }: { board: Board; lane: Swimlane; agents: SwimlaneAgent[]; reload: () => void }) {
  const t = useTranslations('boardConfig');
  // The user picks an agent from the project's registered/workforce agents; that
  // agent already carries its runtime/host/model defaults, so the form is just
  // "which agent" + an optional model override.
  const [agentSel, setAgentSel] = useState(''); // 'kind:ref'
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [model, setModel] = useState('');
  const [available, setAvailable] = useState<PoolAgent[]>([]);
  const [adding, setAdding] = useState(false);

  // SCOPED TO THIS BOARD'S TEAMS. An agent is registered once to the tenant and can be
  // assigned to any surface, but a board belongs to a team: offering the whole workspace
  // here let an operator staff a lane with an agent from a team that has nothing to do
  // with the project. `loadProjectAgentPool` narrows to the project's team membership and
  // falls back to the full pool when the project has no teams (see its doc).
  useEffect(() => {
    if (!adding) return;
    let live = true;
    loadProjectAgentPool(board.projectId).then((a) => { if (live) setAvailable(a); }).catch(() => {});
    return () => { live = false; };
  }, [adding, board.projectId]);

  const add = async () => {
    if (!agentSel) return;
    const [agentKind, agentRef] = agentSel.split(':') as ['workforce' | 'registered', string];
    await boardsApi.agents.create(board.id, lane.id, {
      agentKind,
      agentRef,
      name: name.trim() || null,
      role: role.trim() || null,
      model: model.trim() || null,
      position: agents.length,
    });
    setAgentSel(''); setName(''); setRole(''); setModel(''); setAdding(false); reload();
  };
  const remove = async (id: string) => { await boardsApi.agents.remove(board.id, lane.id, id); reload(); };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>{t('autonomousAgents')}</div>
      {agents.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('noAgentsInLane')}</div>}
      {agents.map((a) => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' }}>
          <span style={{ fontWeight: 600 }}>{a.name ?? a.role}</span>
          <span className="badge-blue" style={{ fontSize: 10, padding: '1px 7px', borderRadius: 'var(--radius-sm)', textTransform: 'capitalize' }} title={t('roleTitle')}>
            {a.role}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {a.runtime}
            {a.model ? ` · ${a.model}` : ` · ${t('defaultLlm')}`}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" style={{ ...btnSubtle, color: 'var(--danger)' }} onClick={() => remove(a.id)}>{t('remove')}</button>
        </div>
      ))}
      {adding ? (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Select value={agentSel} onChange={(e) => setAgentSel(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 180 }} aria-label={t('selectAgent')}>
              <option value="">{t('selectAgent')}</option>
              {available.map((a) => (
                <option key={`${a.kind}:${a.ref}`} value={`${a.kind}:${a.ref}`}>{a.name}</option>
              ))}
            </Select>
            <input style={{ ...inputStyle, width: 140 }} placeholder={t('namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} title={t('nameTitle')} />
            <input style={{ ...inputStyle, width: 120 }} placeholder={t('rolePlaceholder')} value={role} onChange={(e) => setRole(e.target.value)} title={t('roleTitle')} />
            <input style={{ ...inputStyle, width: 160 }} placeholder={t('modelPlaceholder')} value={model} onChange={(e) => setModel(e.target.value)} />
            <button type="button" style={btnPrimary} onClick={add} disabled={!agentSel}>{t('add')}</button>
            <button type="button" style={btnSubtle} onClick={() => { setAdding(false); setAgentSel(''); setName(''); setRole(''); setModel(''); }}>{t('cancel')}</button>
          </div>
          {available.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              {t('noAgentsRegistered')}
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" style={btnSubtle} onClick={() => setAdding(true)}>{t('assignAgent')}</button>
          {agents.length > 0 && <LaneRunNowButton boardId={board.id} laneId={lane.id} style={btnSubtle} />}
        </div>
      )}
    </div>
  );
}

/**
 * Assign workforce Teams to this board. A board is 1:1 with its project, so
 * "assign a team to the board" attaches the team to the board's project
 * (team_projects). Members of an attached team are managed in Workforce → Teams;
 * this tab only governs which teams work this board.
 */
