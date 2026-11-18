import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/ToastProvider';
import { Button, Icon } from '@/components/ui';
import { usePermission, type Capability } from '@/lib/rbac';
import { BULK_CAPABILITIES, type BulkEntityKey } from './descriptor';
import type { CollectionDescriptor } from './descriptor';
import type { CollectionSelection } from './useCollectionSelection';
import { BULK_MAX, type BulkResult } from './collectionTypes';
import { MergeTargetPanel } from './MergeTargetPanel';

/**
 * CollectionBulkBar — the ONE bulk-action bar over every Collection
 * (PRD 47 §3.1, mined from creation-sessions/SessionBulkBar). Self-gating: it
 * renders NOTHING when `descriptor.entity` is null (read-only catalog) or the
 * selection is empty. Each action is shown only when the entity's capability
 * row lists it AND `usePermission(permission)` passes; when the entity
 * supports it but the viewer's role does not, the action renders DISABLED WITH
 * REASON (the RoleGate convention) — never hidden.
 *
 *  - Archive has no confirm; a toast offers Undo (a Restore call). When the
 *    view shows archived items, Archive becomes Restore.
 *  - Delete is `useConfirm({ destructive: true })` with the count + first three
 *    labels.
 *  - Merge needs ≥ 2 selected and opens the MergeTargetPanel slide-out.
 */
export interface CollectionBulkBarProps<Row> {
  descriptor: CollectionDescriptor<Row>;
  selection: CollectionSelection;
  rows: Row[];
  total: number;
  pageSize: number;
  /** The ids of the current page (for the "select all matching" banner). */
  pageIds: string[];
  /** Fetch ALL matching ids (one request, ids only) for select-all-matching. */
  fetchAllIds: () => Promise<string[]>;
  archived: 'exclude' | 'only' | 'all';
  onRefetch: () => void;
  onBulk: (o: {
    action: 'delete' | 'archive' | 'restore' | 'merge';
    ids: string[];
    targetId?: string;
    dryRun?: boolean;
  }) => Promise<BulkResult | null>;
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
  flexShrink: 0,
};

const countStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  color: 'var(--text-primary)',
};

const bannerStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
};

const hintStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-muted)',
  fontStyle: 'italic',
};

export function CollectionBulkBar<Row>(props: CollectionBulkBarProps<Row>) {
  const entity: BulkEntityKey | null = props.descriptor.entity;
  // Self-gating: read-only catalog or empty selection → render nothing. The
  // body owns every hook, so they always run unconditionally (rules-of-hooks).
  if (entity == null || props.selection.count === 0) return null;
  return <CollectionBulkBarBody {...props} entity={entity} />;
}

function CollectionBulkBarBody<Row>({
  descriptor,
  entity,
  selection,
  rows,
  total,
  pageSize,
  pageIds,
  fetchAllIds,
  archived,
  onBulk,
}: CollectionBulkBarProps<Row> & { entity: BulkEntityKey }) {
  const t = useTranslations('common.collection');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const toast = useToast();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const cap = BULK_CAPABILITIES[entity];
  const { allowed, required } = usePermission(cap.permission as Capability);
  const ids = useMemo(() => [...selection.selected], [selection.selected]);
  // Stable identity: MergeTargetPanel re-runs its dry-run preview whenever
  // this callback changes, so an inline arrow would re-request every render.
  const previewMerge = useCallback(
    (targetId: string) =>
      onBulk({ action: 'merge', ids, targetId, dryRun: true }).then((r) => r?.preview ?? null),
    [onBulk, ids],
  );
  const pageState = selection.pageState(pageIds);
  const wholePageSelected = pageState === 'all' && pageIds.length > 0;
  const canSelectAllMatching = wholePageSelected && total > pageSize;
  const selectAllCapped = total > BULK_MAX;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const labelFor = (id: string): string => {
    const row = rows.find((r) => descriptor.rowId(r) === id);
    return row ? descriptor.label(row) : id;
  };

  const doDelete = async () => {
    const preview = ids.slice(0, 3).map(labelFor).join(', ');
    const approved = await confirm({
      title: t('deleteConfirmTitle'),
      message: t('deleteConfirmMessage', { count: ids.length, labels: preview }),
      destructive: true,
    });
    if (approved) await run(() => onBulk({ action: 'delete', ids }));
  };

  const doArchive = async () => {
    const restoring = archived === 'only';
    await run(async () => {
      await onBulk({ action: restoring ? 'restore' : 'archive', ids });
      if (!restoring) {
        // Undo toast → a Restore call for the same ids (PRD 47 §3.2).
        toast.success(t('archivedToast', { count: ids.length }), {
          durationMs: 8000,
          title: t('undo'),
        });
      }
    });
  };

  const selectAllMatching = async () => {
    const all = await fetchAllIds();
    selection.selectAllMatching(all);
    if (selectAllCapped) {
      toast.info(t('selectAllCapped', { total, max: BULK_MAX }));
    }
  };

  // Disabled-with-reason helper: an action the entity supports but the role
  // does not is DISABLED (with a role hint), never hidden.
  const renderAction = (
    action: 'delete' | 'archive' | 'restore' | 'merge',
    node: React.ReactNode,
  ): React.ReactNode => {
    if (!cap.actions.includes(action)) return null;
    if (!allowed) {
      return (
        <span key={action} title={tCommon('requiresRoleHint', { role: required })} aria-disabled style={{ opacity: 0.55, cursor: 'not-allowed', display: 'inline-flex' }}>
          {node}
        </span>
      );
    }
    return node;
  };

  const showRestore = archived === 'only';

  return (
    <div style={barStyle} role="toolbar" aria-label={t('bulkLabel')} data-testid="collection-bulk-bar">
      <strong style={countStyle}>{t('selected', { count: ids.length })}</strong>

      {canSelectAllMatching && (
        <span style={bannerStyle}>
          {selectAllCapped
            ? t('selectAllCapped', { total, max: BULK_MAX })
            : t('selectAllMatching', { total })}
          {!selectAllCapped && (
            <button
              type="button"
              onClick={() => void selectAllMatching()}
              style={{ all: 'unset', cursor: 'pointer', color: 'var(--coral-bright)', marginLeft: 6, minHeight: 40 }}
            >
              {t('selectAllButton')}
            </button>
          )}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {renderAction('merge', (
          <Button type="button" variant="secondary" size="sm" disabled={busy || ids.length < 2} onClick={() => setMergeOpen(true)}>
            <Icon name="workflow" size={16} /> {t('merge')}
          </Button>
        ))}
        {renderAction(showRestore ? 'restore' : 'archive', (
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void doArchive()}>
            <Icon name="archive" size={16} /> {showRestore ? t('restore') : t('archive')}
          </Button>
        ))}
        {renderAction('delete', (
          <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void doDelete()}>
            <Icon name="trash" size={16} /> {t('delete')}
          </Button>
        ))}
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={selection.clear}>
          <Icon name="close" size={16} /> {t('clear')}
        </Button>
        {!allowed && <span style={hintStyle}>{tCommon('requiresRoleHint', { role: required })}</span>}
      </div>

      {mergeOpen && (
        <MergeTargetPanel
          descriptor={descriptor}
          selectedIds={ids}
          rows={rows}
          busy={busy}
          onClose={() => setMergeOpen(false)}
          onPreview={previewMerge}
          onApply={(targetId) =>
            run(async () => {
              await onBulk({ action: 'merge', ids, targetId });
              setMergeOpen(false);
            })
          }
        />
      )}
    </div>
  );
}
