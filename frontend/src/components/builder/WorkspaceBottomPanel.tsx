// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { Terminal } from '@/components/Terminal';
import { useWorkspaceCommands, type BottomPanelTab } from '@/lib/workspace/workspaceCommands';
import { ProblemsPanel } from './ProblemsPanel';
import { useBuildFailures } from './useBuildFailures';
import styles from './workspaceChrome.module.css';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

const EXPANDED_HEIGHT = 240;
const BAR_HEIGHT = 34;

/**
 * The workspace's bottom panel. Closed, it is a status bar: whether the app is
 * running (`summary`, the host's), whether anything is wrong, and the Terminal
 * toggle — the preview starts by itself, so the terminal is something you open to
 * look into a problem, not a third of the screen held back from the app.
 *
 * Open, it is tabs: the interactive Terminal (run output and the shell), Output
 * (what a publish build printed) and Problems (recorded build and runtime
 * failures), with the host's tools for them (`tools`: the checks) on the right.
 * Every pane stays mounted so a terminal keeps its scrollback across tab changes.
 */
export function WorkspaceBottomPanel({ projectId, onTerminalReady, onTerminalInput, onOutputReady, summary, tools }: {
  projectId: WorkspaceId;
  onTerminalReady: (write: (data: string) => void) => void;
  onTerminalInput: (data: string) => void;
  onOutputReady: (write: (data: string) => void) => void;
  /** The closed bar's standing facts, at its start (the run status). */
  summary?: ReactNode;
  /** The open panel's tools, at the end of its tab row (the checks). */
  tools?: ReactNode;
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

  const open = (id: BottomPanelTab) => { setTab(id); setExpanded(true); };

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
        height: expanded ? EXPANDED_HEIGHT : BAR_HEIGHT,
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'var(--bg-deep)',
        transition: 'height 0.2s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'stretch', minHeight: BAR_HEIGHT - 1, borderBottom: expanded ? '1px solid var(--border-subtle)' : 'none', background: 'var(--bg-elevated)', flexShrink: 0, overflowX: 'auto' }}>
        {expanded ? (
          <div role="tablist" aria-label={t('panelLabel')} style={{ display: 'flex', alignItems: 'stretch' }}>
            {tabs.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => open(id)}
                style={{
                  padding: '6px 12px', border: 0, background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  color: tab === id ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}`,
                  fontSize: 'var(--font-size-small)', fontWeight: 600,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <>
            {summary}
            <button type="button" className={styles.statusItem} data-tone={failures.length ? 'error' : 'ok'} onClick={() => open('problems')}>
              <Icon name={failures.length ? 'warning' : 'check'} size={14} />
              {failures.length ? t('problemsCount', { count: failures.length }) : t('noProblemsShort')}
            </button>
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{expanded && tools}</div>
        <button
          type="button"
          className={styles.statusItem}
          onClick={() => setExpanded((was) => !was)}
          aria-expanded={expanded}
          aria-label={t(expanded ? 'collapse' : 'expand')}
          title={t(expanded ? 'collapse' : 'expand')}
        >
          {!expanded && <Icon name="code" size={14} />}
          {!expanded && t('terminal')}
          <Icon name={expanded ? 'chevron-down' : 'arrow-up'} size={13} />
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
