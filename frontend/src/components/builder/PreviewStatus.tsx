// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useDockedBrain } from '@/lib/brain/dockedBrain';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';
import type { BuildFailure } from '@/lib/buildDiagnostics';
import { useBuildFailures } from './useBuildFailures';
import type { RunStep } from './useWorkspaceRun';
import styles from './workspaceChrome.module.css';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

export type PreviewStatusState = 'starting' | 'failed' | 'blocked' | 'empty';

const STEPS: readonly RunStep[] = ['preparing', 'installing', 'starting'];

/** Starting points offered on an empty project — each fills the chat for the person to finish. */
const SUGGESTIONS = ['landing', 'portfolio', 'menu'] as const;

/** How much of a failure's output rides along in the "fix it" message. */
const FIX_DETAIL_CHARS = 1500;

/**
 * What the preview says when there is no app to show. It never asks anyone to
 * press Run: the preview starts by itself, so this either shows that it is
 * starting (and which step it is on), why it stopped and how to get it back, or
 * that there is nothing to show yet and where to start.
 */
export function PreviewStatus({ state, step, projectId, onRetry, onOpenVersions }: {
  state: PreviewStatusState;
  step: RunStep | null;
  projectId: WorkspaceId;
  onRetry: () => void;
  /** Opens the project's versions, when it has them. */
  onOpenVersions?: () => void;
}) {
  const t = useTranslations('ide.workspace');

  if (state === 'starting') {
    const current = step ? STEPS.indexOf(step) : 0;
    return (
      <StatusCard icon={<span className={styles.spinner} aria-hidden />} title={t('startingTitle')} hint={t('startingHint')} live>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, width: '100%', textAlign: 'left' }}>
          {STEPS.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-size-small)', color: done ? 'var(--success-text)' : active ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>
                <Icon name={done ? 'check' : active ? 'activity' : 'minus'} size={15} />
                {t(`step.${s}`)}
              </li>
            );
          })}
        </ol>
      </StatusCard>
    );
  }

  if (state === 'failed' || state === 'blocked') {
    return <StoppedStatus blocked={state === 'blocked'} projectId={projectId} onRetry={onRetry} onOpenVersions={onOpenVersions} />;
  }

  return <EmptyStatus />;
}

/** The preview stopped: what broke, and three ways back — Brain fixes it, run it again, or go back a version. */
function StoppedStatus({ blocked, projectId, onRetry, onOpenVersions }: {
  blocked: boolean;
  projectId: WorkspaceId;
  onRetry: () => void;
  onOpenVersions?: () => void;
}) {
  const t = useTranslations('ide.workspace');
  const docked = useDockedBrain();
  // The run's FIRST failure: failures are cleared when a run starts, so the first
  // one recorded since is the cause and anything after it is usually fallout.
  const failure = useBuildFailures(projectId)[0];
  const showTerminal = () => sendWorkspaceCommand(projectId, { type: 'showPanel', panel: 'terminal' });
  const fix = docked && failure ? () => docked.ask(fixPrompt(t('fixPrompt'), failure)) : null;

  return (
    <StatusCard
      icon={<StatusGlyph name="warning" tone="error" />}
      title={t(blocked ? 'blockedTitle' : 'failedTitle')}
      hint={t(blocked ? 'blockedHint' : fix ? 'failedHintFix' : 'failedHint')}
    >
      {failure && (
        <div className={styles.failureBox}>
          <span>{failure.message}</span>
          {failure.at && <span style={{ color: 'var(--text-secondary)' }}>{failure.at}</span>}
        </div>
      )}
      <div style={{ width: '100%', display: 'grid', gap: 8 }}>
        {fix && (
          <Button type="button" variant="primary" size="sm" onClick={fix}>
            <Icon name="sparkles" size={14} /> {t('fixForMe')}
          </Button>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button type="button" variant={fix ? 'secondary' : 'primary'} size="sm" onClick={onRetry} style={{ flex: '1 1 auto' }}>
            <Icon name="refresh" size={14} /> {t('tryAgain')}
          </Button>
          {onOpenVersions && (
            <Button type="button" variant="secondary" size="sm" onClick={onOpenVersions} style={{ flex: '1 1 auto' }}>
              <Icon name="clock" size={14} /> {t('versions')}
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={showTerminal} style={{ flex: '1 1 auto' }}>{t('showTerminal')}</Button>
        </div>
      </div>
    </StatusCard>
  );
}

/** Nothing to show yet: where to start. Each suggestion fills the chat for the person to finish and send. */
function EmptyStatus() {
  const t = useTranslations('ide.workspace');
  const docked = useDockedBrain();
  return (
    <StatusCard icon={<StatusGlyph name="eye" tone="accent" />} title={t('emptyTitle')} hint={t('emptyHint')} dashed>
      {docked && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
          {SUGGESTIONS.map((id) => (
            <button key={id} type="button" className={styles.suggestion} onClick={() => docked.seedComposer(t(`suggestion.${id}.prompt`))}>
              {t(`suggestion.${id}.label`)}
            </button>
          ))}
        </div>
      )}
    </StatusCard>
  );
}

/** The message "Fix it for me" sends: the instruction, then the error as the preview recorded it. */
function fixPrompt(instruction: string, failure: BuildFailure): string {
  const detail = failure.detail ? `\n\n${failure.detail.slice(-FIX_DETAIL_CHARS)}` : '';
  const where = failure.at ? `\n${failure.at}` : '';
  return `${instruction}\n\n\`\`\`\n${failure.message}${where}${detail}\n\`\`\``;
}

function StatusCard({ icon, title, hint, live, dashed, children }: {
  icon: ReactNode;
  title: string;
  hint: string;
  live?: boolean;
  dashed?: boolean;
  children?: ReactNode;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg-deep)', overflowY: 'auto' }}>
      <div
        role="status"
        aria-live={live ? 'polite' : undefined}
        style={{
          width: 'min(380px, 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          padding: '24px 20px', textAlign: 'center', borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-surface)', border: `1px ${dashed ? 'dashed' : 'solid'} var(--border-subtle)`,
        }}
      >
        {icon}
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>{title}</strong>
          <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{hint}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusGlyph({ name, tone }: { name: IconName; tone: 'error' | 'accent' }) {
  return (
    <span
      aria-hidden
      style={{
        width: 44, height: 44, borderRadius: '50%', display: 'grid', placeItems: 'center',
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        color: tone === 'error' ? 'var(--error-text)' : 'var(--accent)',
      }}
    >
      <Icon name={name} size={20} />
    </span>
  );
}
