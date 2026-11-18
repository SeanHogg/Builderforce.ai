import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Select } from '@/components/Select';
import { Button } from '@/components/ui';
import type { CollectionDescriptor } from './descriptor';

/**
 * MergeTargetPanel — the merge slide-out (PRD 47 §3.1, mined from
 * SessionEditorPanel's merge usage). Picks the record to KEEP from a Select of
 * the selected records, shows a dryRun preview built from the preview counts
 * (e.g. "moves 34 tasks, 3 PRDs; 2 projects archived"), then an Apply button
 * commits the merge.
 */
export interface MergeTargetPanelProps<Row> {
  descriptor: CollectionDescriptor<Row>;
  selectedIds: string[];
  rows: Row[];
  busy?: boolean;
  onClose: () => void;
  /** dryRun merge; returns the preview counts to render. */
  onPreview: (targetId: string) => Promise<Record<string, number> | null>;
  /** Apply the merge for real. */
  onApply: (targetId: string) => Promise<void>;
}

const fieldStyle: React.CSSProperties = { display: 'grid', gap: 6, marginBottom: 16 };
const labelStyle: React.CSSProperties = { fontSize: 'var(--font-size-field-label)', color: 'var(--text-secondary)' };

const previewStyle: React.CSSProperties = {
  padding: 12,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-secondary)',
  marginBottom: 16,
};

export function MergeTargetPanel<Row>({
  descriptor,
  selectedIds,
  rows,
  busy,
  onClose,
  onPreview,
  onApply,
}: MergeTargetPanelProps<Row>) {
  const t = useTranslations('common.collection');
  const [target, setTarget] = useState(selectedIds[0] ?? '');
  const [preview, setPreview] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (target) {
      onPreview(target).then((counts) => {
        if (!cancelled) setPreview(counts);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [target, onPreview]);

  const labelFor = (id: string): string => {
    const row = rows.find((r) => descriptor.rowId(r) === id);
    return row ? descriptor.label(row) : id;
  };

  const applyDisabled = busy || !target || !selectedIds.includes(target);

  return (
    <SlideOutPanel open onClose={onClose} title={t('mergeTitle')} width="sheet">
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="merge-target">{t('mergeTarget')}</label>
        <Select
          id="merge-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label={t('mergeTarget')}
        >
          {selectedIds.map((id) => (
            <option key={id} value={id}>{labelFor(id)}</option>
          ))}
        </Select>
      </div>

      {preview && (
        <div style={previewStyle} data-testid="merge-preview">
          {Object.entries(preview).map(([k, n]) => t('mergePreviewLine', { n, what: k })).join('; ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" variant="primary" disabled={applyDisabled} loading={busy} onClick={() => void onApply(target)}>
          {t('merge')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>{t('cancel')}</Button>
      </div>
    </SlideOutPanel>
  );
}
