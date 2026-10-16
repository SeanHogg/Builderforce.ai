/**
 * Saved segments (PRD 33 §2.1 "Filters + saved segments"): a named
 * `ReplayFilter` per site. List, apply, save the current filter, rename and
 * delete (destructive → `useConfirm`). Writes need a manager; the API says no
 * otherwise and the transport shows why.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayFilter, ReplaySegmentDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useConfirm } from '@/components/ConfirmProvider';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useAdminData } from '@/components/admin/adminShared';
import { Icon } from '@/components/ui/Icon';
import { filterKey } from './useReplayFilter';

export interface SegmentMenuProps {
  siteId: string;
  filter: ReplayFilter;
  onApply: (filter: ReplayFilter) => void;
}

const popoverStyle = {
  position: 'absolute',
  top: '100%',
  right: 0,
  zIndex: 20,
  width: 'min(320px, calc(100vw - 32px))',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--surface-card)',
  boxShadow: 'var(--shadow-sm)',
} as const;

export function SegmentMenu({ siteId, filter, onApply }: SegmentMenuProps) {
  const t = useTranslations('replay.segments');
  const confirm = useConfirm();
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data, reload } = useAdminData<ReplaySegmentDto[]>(() => replayApi.listSegments(siteId), [siteId]);
  const segments = data ?? [];
  const current = filterKey(filter);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      reload();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(async () => {
    await replayApi.createSegment(siteId, { name: name.trim(), filter });
    setName('');
  });

  const rename = () => run(async () => {
    if (!renaming) return;
    await replayApi.updateSegment(siteId, renaming.id, { name: renaming.name.trim() });
    setRenaming(null);
  });

  const remove = async (segment: ReplaySegmentDto) => {
    const ok = await confirm({
      title: t('deleteTitle'),
      message: t('deleteConfirm', { name: segment.name }),
      confirmLabel: t('delete'),
      destructive: true,
    });
    if (!ok) return;
    await run(() => replayApi.deleteSegment(siteId, segment.id));
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="btn-ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{ minHeight: 44 }}
      >
        <Icon name="folder" size={14} /> {t('button')}
      </button>
      {open && (
        <div role="dialog" aria-label={t('aria')} style={popoverStyle}>
          {segments.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('empty')}</p>}
          {segments.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', maxHeight: 240, overflowY: 'auto' }}>
              {segments.map((segment) => (
                <li key={segment.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', minWidth: 0 }}>
                  {renaming?.id === segment.id ? (
                    <form
                      style={{ display: 'flex', gap: 'var(--space-1)', flex: 1, minWidth: 0 }}
                      onSubmit={(event) => { event.preventDefault(); void rename(); }}
                    >
                      <input
                        className="input"
                        value={renaming.name}
                        aria-label={t('renameAria', { name: segment.name })}
                        onChange={(event) => setRenaming({ id: segment.id, name: event.currentTarget.value })}
                        style={{ flex: 1, minWidth: 0, minHeight: 44 }}
                      />
                      <button type="submit" className="btn-secondary" disabled={busy || !renaming.name.trim()} style={{ minHeight: 44 }}>{t('saveName')}</button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={filterKey(segment.filter) === current ? 'btn-secondary' : 'btn-ghost'}
                        aria-pressed={filterKey(segment.filter) === current}
                        aria-label={t('applyAria', { name: segment.name })}
                        onClick={() => { onApply(segment.filter); setOpen(false); }}
                        style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'flex-start', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {segment.name}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        aria-label={t('renameAria', { name: segment.name })}
                        onClick={() => setRenaming({ id: segment.id, name: segment.name })}
                        style={{ minHeight: 44, minWidth: 44 }}
                      >
                        <Icon name="edit" size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        aria-label={t('deleteAria', { name: segment.name })}
                        disabled={busy}
                        onClick={() => void remove(segment)}
                        style={{ minHeight: 44, minWidth: 44 }}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            style={{ display: 'flex', gap: 'var(--space-1)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-2)' }}
            onSubmit={(event) => { event.preventDefault(); void save(); }}
          >
            <input
              className="input"
              value={name}
              placeholder={t('namePlaceholder')}
              aria-label={t('nameAria')}
              onChange={(event) => setName(event.currentTarget.value)}
              style={{ flex: 1, minWidth: 0, minHeight: 44 }}
            />
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !name.trim() || filter.all.length === 0}
              title={filter.all.length === 0 ? t('saveNeedsFilter') : undefined}
              style={{ minHeight: 44 }}
            >
              {t('save')}
            </button>
          </form>
          {error && <p role="alert" style={{ margin: 0, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</p>}
        </div>
      )}
    </span>
  );
}
