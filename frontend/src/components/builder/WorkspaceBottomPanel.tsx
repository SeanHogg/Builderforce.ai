// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Terminal } from '@/components/Terminal';
import { useWorkspaceCommands, type BottomPanelTab } from '@/lib/workspace/workspaceCommands';
import { ProblemsPanel } from './ProblemsPanel';
import { useBuildFailures } from './useBuildFailures';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

const EXPANDED_HEIGHT = 240;
const COLLAPSED_HEIGHT = 36;

/**
 * The workspace's bottom panel, as tabs: the interactive Terminal (run output and
 * the shell), Output (what a publish build printed, kept apart so it is not lost
 * among shell lines), and Problems (the recorded build and runtime failures).
 * Every pane stays mounted so a terminal keeps its scrollback across tab changes.
 *
 * It starts COLLAPSED to a status bar: the preview starts by itself, so the
 * terminal is something you open to look into a problem, not a third of the
 * screen held back from the app. `status` is the host's standing facts and
 * controls (the checks) on the right of that bar.
 */
export function WorkspaceBottomPanel({ projectId, onTerminalReady, onTerminalInput, onOutputReady, status }: {
  projectId: WorkspaceId;
  onTerminalReady: (write: (data: string) => void) => void;
  onTerminalInput: (data: string) => void;
  onOutputReady: (write: (data: string) => void) => void;
  status?: ReactNode;
}) {
  const t = useTranslations('builderPanels');
  const [tab, setTab] = useState<BottomPanelTab>('terminal');
  const [expanded, setExpanded] = useState(false);
  const failures = useBuildFailures(projectId);

  useWorkspaceCommands(projectId, (command) => {
    if (command.type !== 'showPanel') return;
    setTab(command.panel);
    setExpanded(true);
  });

  const tabs: Array<{ id: BottomPanelTab; label: string }> = [
    { id: 'terminal', label: t('terminal') },
    { id: 'output', label: t('output') },
    { id: 'problems', label: failures.length ? t('problemsCount', { count: failures.length }) : t('problems') },
  ];

  const pane = (id: BottomPanelTab) => ({
    flex: 1, minHeight: 0, minWidth: 0, width: '100%',
    display: expanded && tab === id ? 'flex' : 'none',
  } as const);

  return (
    <div
      style={{
        height: expanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT,
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'var(--bg-deep)',
        transition: 'height 0.2s ease',
      }}
    >
      <div role="tablist" aria-label={t('panelLabel')} style={{ display: 'flex', alignItems: 'stretch', borderBottom: expanded ? '1px solid var(--border-subtle)' : 'none', background: 'var(--bg-elevated)', flexShrink: 0, overflowX: 'auto' }}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => { setTab(id); setExpanded(true); }}
            style={{
              padding: '6px 12px', minHeight: COLLAPSED_HEIGHT - 1, border: 0, background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === id && expanded ? 'var(--accent)' : 'transparent'}`,
              fontSize: 'var(--font-size-small)', fontWeight: 600,
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{status}</div>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'collapse' : 'expand')}
          style={{ padding: '0 12px', border: 0, background: 'none', color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
        >
          <span aria-hidden>{expanded ? '▾' : '▴'}</span>
        </button>
      </div>
      <div role="tabpanel" style={pane('terminal')}>
        <Terminal onReady={onTerminalReady} onInput={onTerminalInput} />
      </div>
      <div role="tabpanel" style={pane('output')}>
        <Terminal readOnly onReady={onOutputReady} />
      </div>
      <div role="tabpanel" style={pane('problems')}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ProblemsPanel projectId={projectId} failures={failures} />
        </div>
      </div>
    </div>
  );
}
