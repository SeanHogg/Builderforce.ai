'use client';

/**
 * ORPHANED TICKETS — the tickets sitting in no column at all.
 *
 * `tasks.swimlane_id IS NULL` (migration 1115). The board appends a fallback
 * column so none of them is hidden, but a fallback column is not a lane: no gate,
 * no staffed agent and no requirement applies to a ticket whose status no lane
 * defines, so it can never auto-run and never advance. It is invisible work, and
 * the lane editor is where it can actually be fixed.
 *
 * Self-contained on purpose: it owns its own fetch, its own empty state and its
 * own entitlement, and renders NOTHING when the board has no orphans — which is
 * the normal case. Drop it into any surface that knows a board and its lanes.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/Select';
import { RoleGate } from '@/components/RoleGate';
import { boardsApi, type Board, type Swimlane } from '@/lib/builderforceApi';
import { btnPrimary, inputStyle } from './configStyles';

export function OrphanedTicketsRow({ board, lanes, reload }: {
  board: Board; lanes: Swimlane[]; reload: () => void;
}) {
  const t = useTranslations('boardConfig');
  const [count, setCount] = useState(0);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCount(await boardsApi.orphanedTasks.count(board.id));
    } catch {
      // A census that cannot be read is not a census that says zero — but there is
      // nothing to offer the operator either, so the row simply stays hidden.
      setCount(0);
    }
  }, [board.id]);

  useEffect(() => { void refresh(); }, [refresh, lanes]);

  // Default to the first lane work can actually flow through: re-homing a stranded
  // ticket into Done or a parking lane would hide it a second time.
  const defaultKey = (lanes.find((l) => !l.isTerminal && !l.isParking) ?? lanes[0])?.key ?? '';
  const chosen = target || defaultKey;

  const adopt = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      await boardsApi.orphanedTasks.adopt(board.id, chosen);
      await refresh();
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (count === 0 || lanes.length === 0) return null;

  return (
    <div
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        marginBottom: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--warning-border)', background: 'var(--warning-bg)',
        color: 'var(--warning-text)', fontSize: 12,
      }}
    >
      <span style={{ flex: 1, minWidth: 200 }}>{t('orphanedTickets', { count })}</span>
      <RoleGate capability="board.manageLanes">
        <Select
          value={chosen}
          onChange={(e) => setTarget(e.target.value)}
          style={{ ...inputStyle, minWidth: 130 }}
          aria-label={t('orphanedAdoptInto')}
          title={t('orphanedAdoptIntoTitle')}
        >
          {lanes.map((l) => <option key={l.id} value={l.key}>{l.name}</option>)}
        </Select>
        <button type="button" style={btnPrimary} disabled={busy || !chosen} onClick={adopt}>
          {t('orphanedAdopt')}
        </button>
      </RoleGate>
    </div>
  );
}
