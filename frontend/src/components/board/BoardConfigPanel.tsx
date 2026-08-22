'use client';

/**
 * Board-config slide-out, opened from the Task-Mgmt cog — the SHELL only.
 *
 * It was 849 lines: four tabs, three lane sub-rows, the whole swimlane editor, the
 * team-attachment surface, the board-settings form, and the effect that creates a
 * missing board, all in one file behind a four-way ternary. Configuring a lane's
 * entry gate and attaching a team to a project have nothing to say to each other,
 * and putting them in one module meant every one of those changes landed here.
 *
 * What remains is the shell: pick a tab, show the loading/error state, render the
 * tab. Each tab is its own component in `config/`, and the auto-heal is a hook.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '../SlideOutPanel';
import { BoardConnectionsManager } from '../integrations/BoardConnectionsManager';
import { useBoardConfig } from './useBoardConfig';
import { LanesTab } from './config/LanesTab';
import { TeamsTab } from './config/TeamsTab';
import { SettingsTab } from './config/SettingsTab';
import { sectionPad } from './config/configStyles';
import { useBoardProvisioning } from './config/useBoardProvisioning';

/** The tab set, as data — a fifth tab is a row here, not another ternary arm. */
const CONFIG_TABS = ['lanes', 'teams', 'settings', 'external'] as const;
export type ConfigTab = (typeof CONFIG_TABS)[number];

export interface BoardConfigPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: number;
  projectName?: string;
  /** Which tab to open on. Defaults to 'lanes'; the approval banner opens 'settings'. */
  initialTab?: ConfigTab;
}

export function BoardConfigPanel({ open, onClose, projectId, projectName, initialTab = 'lanes' }: BoardConfigPanelProps) {
  const t = useTranslations('boardConfig');
  const [tab, setTab] = useState<ConfigTab>(initialTab);
  // Re-sync the active tab each time the panel is (re)opened so a caller that
  // requests 'settings' always lands there, even after a prior open left another
  // tab selected.
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);

  const { board, lanes, agentsByLane, loading, error, reload } = useBoardConfig(projectId, open);
  const { provisioning, provisionError } = useBoardProvisioning({
    open, board, laneCount: lanes.length, loading, error, projectId, projectName, reload,
  });

  const shownError = error ?? provisionError;
  const busy = loading || provisioning || !board;

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={t('title')}
      width="min(720px, 96vw)"
      tabs={CONFIG_TABS.map((id) => ({ id, label: t(`tab.${id}`) }))}
      activeTabId={tab}
      onTabChange={(next) => setTab(next as ConfigTab)}
    >
      {busy || shownError ? (
        <div style={sectionPad}>
          <span style={{ fontSize: 'var(--font-size-small)', color: shownError ? 'var(--danger)' : 'var(--text-muted)' }}>
            {shownError ?? (provisioning || !board ? t('settingUp') : t('loading'))}
          </span>
        </div>
      ) : tab === 'lanes' ? (
        <LanesTab board={board} lanes={lanes} agentsByLane={agentsByLane} reload={reload} />
      ) : tab === 'teams' ? (
        <TeamsTab projectId={projectId} />
      ) : tab === 'settings' ? (
        <SettingsTab board={board} projectId={projectId} onSaved={reload} />
      ) : (
        <div style={sectionPad}>
          <BoardConnectionsManager projectId={projectId} heading={t('externalHeading')} />
        </div>
      )}
    </SlideOutPanel>
  );
}
