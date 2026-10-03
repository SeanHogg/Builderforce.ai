// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { InlineConfirmButton } from '@/components/InlineConfirmButton';
import { faultMessage } from '@/lib/apiClient';
import type { ProjectCheckpoint } from '@/lib/api';
import { useFormat } from '@/i18n/useFormat';
import { useProjectVersions } from './useProjectVersions';

const NAMED_FILES = 3;

/**
 * The project's versions, newest first: one per agent turn, a person's named
 * saves, the starting point. Restore puts the whole project back (and saves the
 * current state first, so the restore can be undone the same way).
 *
 * Keep it mounted while the workspace is open: it is also what records versions.
 */
export function VersionsPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('builderVersions');
  const { versions, error, save, restore } = useProjectVersions(projectId);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const onRestore = async (version: ProjectCheckpoint) => {
    setNotice(null);
    setFailure(null);
    try {
      const outcome = await restore(version.id);
      setNotice([
        t('restored', { restored: outcome.restored.length, removed: outcome.removed.length }),
        outcome.missing.length ? t('missing', { count: outcome.missing.length, files: outcome.missing.slice(0, NAMED_FILES).join(', ') }) : '',
      ].filter(Boolean).join(' '));
    } catch (cause) {
      setFailure(faultMessage(cause, t('restoreFailed')));
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SaveVersionForm onSave={async (name) => {
        setFailure(null);
        try { await save(name); } catch (cause) { setFailure(faultMessage(cause, t('saveFailed'))); }
      }} />
      {(notice || failure || error) && (
        <p role={failure || error ? 'alert' : 'status'} style={{ margin: 0, padding: '6px 10px', fontSize: 'var(--font-size-small)', color: failure || error ? 'var(--error-text)' : 'var(--text-secondary)' }}>
          {failure ?? (error ? t('loadFailed') : notice)}
        </p>
      )}
      {versions === null ? (
        <p style={{ margin: 0, padding: 10, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 8, overflowY: 'auto', flex: 1, minHeight: 0, display: 'grid', gap: 8, alignContent: 'start' }}>
          {versions.map((version, index) => (
            <VersionCard key={version.id} version={version} number={versions.length - index} isCurrent={index === 0} onRestore={() => onRestore(version)} />
          ))}
        </ol>
      )}
    </div>
  );
}

function VersionCard({ version, number, isCurrent, onRestore }: { version: ProjectCheckpoint; number: number; isCurrent: boolean; onRestore: () => Promise<void> }) {
  const t = useTranslations('builderVersions');
  const fmt = useFormat();

  const title = version.kind === 'manual' && version.name ? version.name
    : version.kind === 'auto'
      ? t('autoTitle', { files: describeFiles(version.changed, t('someFiles'), (files, more) => t('filesAndMore', { files, more })) })
      : t(version.kind === 'baseline' ? 'baselineTitle' : 'beforeRestoreTitle');

  return (
    <li style={{ padding: 10, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', display: 'grid', gap: 4 }}>
      <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
        {t('meta', { number, time: fmt.dateTime(version.id) })}
      </span>
      {!isCurrent && (
        <span style={{ justifySelf: 'start' }}>
          <InlineConfirmButton className="ui-button ui-button--secondary ui-button--sm" confirmLabel={t('confirmRestore')} hint={t('restoreHint')} onConfirm={onRestore}>
            {t('restore')}
          </InlineConfirmButton>
        </span>
      )}
    </li>
  );
}

/** "App.tsx, Header.tsx, main.tsx and 2 more": file names, not paths, and only a few. */
function describeFiles(paths: string[], none: string, andMore: (files: string, more: number) => string): string {
  if (paths.length === 0) return none;
  const names = paths.slice(0, NAMED_FILES).map((path) => path.split('/').pop() ?? path).join(', ');
  const more = paths.length - NAMED_FILES;
  return more > 0 ? andMore(names, more) : names;
}

function SaveVersionForm({ onSave }: { onSave: (name: string) => Promise<void> }) {
  const t = useTranslations('builderVersions');
  const id = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { await onSave(name.trim()); setName(''); } finally { setBusy(false); }
  };

  return (
    <form onSubmit={(e) => { void submit(e); }} style={{ display: 'flex', gap: 6, padding: 8, borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
      <label htmlFor={id} className="sr-only">{t('nameLabel')}</label>
      <input id={id} className="ui-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} maxLength={80} style={{ flex: '1 1 140px', minWidth: 0 }} />
      <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!name.trim()}>{t('save')}</Button>
    </form>
  );
}
