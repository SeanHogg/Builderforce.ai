'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import PageContainer from '@/components/PageContainer';
import GuidedWizard from './GuidedWizard';
import BulkImport from './BulkImport';

type ImportMode = 'guided' | 'bulk';

/** Mapping from Guided Wizard fields to canonical keys for cross-mode data retention (FR-1.3). */
const GUIDED_TO_BULK_FIELD_MAP: Record<string, string> = {
  name: 'name',
  description: 'description',
  referenceId: 'referenceId',
  enabled: 'enabled',
  priority: 'priority',
  notes: 'notes',
};

export default function ImportPage() {
  const t = useTranslations('import');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();

  const [mode, setMode] = useState<ImportMode>('guided');

  // FR-1.3: retain mappable field data when switching modes.
  const [retainedValues, setRetainedValues] = useState<Record<string, string | null>>({});

  const handleSwitchMode = useCallback(
    async (nextMode: ImportMode) => {
      if (nextMode === mode) return;
      const confirmed = await confirm({
        title: t('modeSwitchTitle'),
        message: t('modeSwitchMessage'),
        destructive: false,
        confirmLabel: t('switch'),
        cancelLabel: tCommon('cancel'),
      });
      if (!confirmed) return;

      setMode(nextMode);
    },
    [mode, confirm, t],
  );

  const handleCancel = useCallback(async () => {
    const confirmed = await confirm({
      title: t('cancelTitle'),
      message: t('cancelMessage'),
      destructive: true,
      confirmLabel: t('discard'),
      cancelLabel: t('keepEditing'),
    });
    if (!confirmed) return;

    setRetainedValues({});
    // Navigate back handled by caller / routing — this just resets local state.
    if (typeof window !== 'undefined') window.history.back();
  }, [confirm, t]);

  const handleGuidedDataChange = useCallback((data: Record<string, string | null>) => {
    setRetainedValues(data);
  }, []);

  const modeLabel = mode === 'guided' ? t('guidedMode') : t('bulkMode');

  return (
    <PageContainer width="readable">
      {/* FR-1.2: mode surfaced in header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            {t('title')}
          </h1>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('modeLabel')}: {modeLabel}
          </span>
        </div>

        {/* FR-1.1: mode toggle */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => handleSwitchMode('guided')}
            aria-pressed={mode === 'guided'}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: mode === 'guided' ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
              background: mode === 'guided' ? 'var(--accent)' : 'var(--bg-base)',
              color: mode === 'guided' ? 'var(--text-on-accent)' : 'var(--text-primary)',
              fontWeight: mode === 'guided' ? 700 : 500,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t('guidedTab')}
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode('bulk')}
            aria-pressed={mode === 'bulk'}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: mode === 'bulk' ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
              background: mode === 'bulk' ? 'var(--accent)' : 'var(--bg-base)',
              color: mode === 'bulk' ? 'var(--text-on-accent)' : 'var(--text-primary)',
              fontWeight: mode === 'bulk' ? 700 : 500,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t('bulkTab')}
          </button>
        </div>
      </div>

      {mode === 'guided' ? (
        <GuidedWizard
          initialValues={retainedValues}
          onDataChange={handleGuidedDataChange}
          onCancel={handleCancel}
        />
      ) : (
        <BulkImport
          initialMappedValues={retainedValues}
          fieldMap={GUIDED_TO_BULK_FIELD_MAP}
          onCancel={handleCancel}
        />
      )}
    </PageContainer>
  );
}
