// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { Icon, type IconName } from '@/components/ui/Icon';
import { sendWorkspaceCommand } from '@/lib/workspace/workspaceCommands';
import type { RunStep } from './useWorkspaceRun';
import styles from './workspaceChrome.module.css';
import type { WorkspaceId } from '@/lib/workspace/workspaceId';

export type PreviewStatusState = 'starting' | 'failed' | 'blocked' | 'empty';

const STEPS: readonly RunStep[] = ['preparing', 'installing', 'starting'];

/**
 * What the preview says when there is no app to show. It never asks anyone to
 * press Run: the preview starts by itself, so this either shows that it is
 * starting (and which step it is on), why it stopped, or that there is nothing
 * to show yet.
 */
export function PreviewStatus({ state, step, projectId, onRetry }: {
  state: PreviewStatusState;
  step: RunStep | null;
  projectId: WorkspaceId;
  onRetry: () => void;
}) {
  const t = useTranslations('ide.workspace');
  const showTerminal = () => sendWorkspaceCommand(projectId, { type: 'showPanel', panel: 'terminal' });

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
    const failed = state === 'failed';
    return (
      <StatusCard
        icon={<StatusGlyph name="warning" tone="error" />}
        title={t(failed ? 'failedTitle' : 'blockedTitle')}
        hint={t(failed ? 'failedHint' : 'blockedHint')}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button type="button" variant="primary" size="sm" onClick={onRetry}>
            <Icon name="refresh" size={14} /> {t('tryAgain')}
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={showTerminal}>{t('showTerminal')}</Button>
        </div>
      </StatusCard>
    );
  }

  return <StatusCard icon={<StatusGlyph name="eye" tone="accent" />} title={t('emptyTitle')} hint={t('emptyHint')} />;
}

function StatusCard({ icon, title, hint, live, children }: {
  icon: ReactNode;
  title: string;
  hint: string;
  live?: boolean;
  children?: ReactNode;
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg-deep)', overflowY: 'auto' }}>
      <div
        role="status"
        aria-live={live ? 'polite' : undefined}
        style={{
          width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          padding: '24px 20px', textAlign: 'center', borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        }}
      >
        {icon}
        <div style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{title}</strong>
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
