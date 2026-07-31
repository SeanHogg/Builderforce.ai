'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { qualityApi } from '@/lib/builderforceApi';
import { QualityCollectorsManager } from '@/components/quality/QualityCollectorsManager';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';

/**
 * Quality dashboard tab — shows the registered error/quality collectors via the
 * shared QualityCollectorsManager (which renders the list, the "enable a
 * collector" empty state, integrations, and stats). A "New collector" action
 * opens the generic SlideOutPanel to create one; on success we remount the
 * manager (bump `refreshKey`) so its list reflects the new collector, since the
 * manager only fetches on mount.
 */
export function DashboardQualityTab() {
  const t = useTranslations('dashboard');
  const { currentProjectId } = useProjectScope();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    try {
      await qualityApi.collectors.create({ projectId: currentProjectId ?? null, name: trimmed });
      setName('');
      setOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('quality.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <RoleGate capability="quality.manageSources">
          <button
            type="button"
            onClick={() => setOpen(true)}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--coral-bright)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('quality.newCollector')}
          </button>
        </RoleGate>
      </div>

      <RoleGate capability="quality.view" variant="block">
        <QualityCollectorsManager key={refreshKey} />
      </RoleGate>

      <SlideOutPanel open={open} onClose={() => setOpen(false)} title={t('quality.newCollector')}>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{t('quality.createHint')}</p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('quality.collectorName')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder={t('quality.collectorNamePlaceholder')}
              autoFocus
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-base)',
                color: 'var(--text-primary)',
                fontSize: 14,
              }}
            />
          </label>
          {error && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>{error}</div>}
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || creating}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--coral-bright)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: !name.trim() || creating ? 'default' : 'pointer',
              opacity: !name.trim() || creating ? 0.6 : 1,
            }}
          >
            {creating ? t('quality.creating') : t('quality.create')}
          </button>
        </div>
      </SlideOutPanel>
    </div>
  );
}
