'use client';

/**
 * Heal a board that should exist and does not.
 *
 * The cog that opens this panel is only reachable when a project board is
 * selected, so a board is expected to exist with its default swimlanes (mirroring
 * the kanban columns). Two states contradict that, and both are fixed here rather
 * than reported as a dead end:
 *
 *   1. No board    → create one (the create route seeds default lanes).
 *   2. Empty board → seed default lanes. This covers a board left lane-less by a
 *      pre-transaction creation failure: kanban still showed columns, but the
 *      panel said "No swimlanes yet".
 *
 * `healedBoard` makes the second heal fire at most once per open, so a user who
 * deliberately deletes every lane does not get them seeded back — each delete
 * reloads through this effect. The error guard stops a retry loop if either step
 * fails.
 *
 * A hook rather than an effect in the panel because it is the one thing in there
 * that WRITES, and a panel that renders four tabs should not also be the module
 * that creates boards.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { boardsApi, type Board } from '@/lib/builderforceApi';

export function useBoardProvisioning({
  open,
  board,
  laneCount,
  loading,
  error,
  projectId,
  projectName,
  reload,
}: {
  open: boolean;
  board: Board | null;
  laneCount: number;
  loading: boolean;
  error: string | null;
  projectId: number;
  projectName?: string;
  reload: () => void;
}): { provisioning: boolean; provisionError: string | null } {
  const t = useTranslations('boardConfig');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const healedBoard = useRef<string | null>(null);

  useEffect(() => {
    if (!open) { setProvisionError(null); healedBoard.current = null; return; }
    if (loading || error || provisioning || provisionError) return;
    if (!board) {
      setProvisioning(true);
      boardsApi
        .create({ projectId, name: t('boardNameDefault', { name: projectName ?? t('projectFallback') }) })
        .then(() => reload())
        .catch((e) => setProvisionError(e instanceof Error ? e.message : t('errCreateBoard')))
        .finally(() => setProvisioning(false));
      return;
    }
    if (laneCount === 0 && healedBoard.current !== board.id) {
      healedBoard.current = board.id;
      setProvisioning(true);
      boardsApi.swimlanes
        .ensureDefaults(board.id)
        .then(() => reload())
        .catch((e) => setProvisionError(e instanceof Error ? e.message : t('errSetupLanes')))
        .finally(() => setProvisioning(false));
    }
  }, [open, loading, error, board, laneCount, provisioning, provisionError, projectId, projectName, reload, t]);

  return { provisioning, provisionError };
}
