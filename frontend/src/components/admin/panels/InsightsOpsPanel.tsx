/**
 * Admin ▸ Growth ▸ Insights operations (PRD 33 D8, D9, D17).
 *
 * The operator's only Insights surface outside a workspace: platform aggregates
 * (never a site, visitor or recording), and for one picked workspace its two
 * switches — excluded from builderforce.ai recording (D9) and the free-allowance
 * override (D8) — plus the audited credit grant (D17). Builderforce's own
 * recordings are read in the Insights app as a member of its workspace.
 *
 * A thin container: the summary tiles and tenant picker live here, the two forms
 * in `components/admin/insightsOps/*`, every call in `lib/replayOpsApi.ts`.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayOpsSummaryDto } from '@builderforce/interaction-contract';
import { Select } from '@/components/Select';
import { adminApi, type AdminTenant } from '@/lib/adminApi';
import { replayOpsApi } from '@/lib/replayOpsApi';
import { formatBytes } from '@/lib/formatBytes';
import { useFormat } from '@/i18n/useFormat';
import { REPLAY_BLOCK } from '@/lib/replaySensitive';
import { AdminError, AdminPanelHeader, StatTile, useAdminData } from '@/components/admin/adminShared';
import { ReplayTenantSettingsForm } from '@/components/admin/insightsOps/ReplayTenantSettingsForm';
import { ReplayGrantForm } from '@/components/admin/insightsOps/ReplayGrantForm';
import { SeedMethodFunnelForm } from '@/components/admin/insightsOps/SeedMethodFunnelForm';

/** The summary tiles, as data: one row per `ReplayOpsSummaryDto` field. */
const SUMMARY_TILES: ReadonlyArray<{
  key: keyof ReplayOpsSummaryDto;
  labelKey: string;
  kind: 'count' | 'bytes' | 'cents';
}> = [
  { key: 'sessions7d', labelKey: 'summary.sessions7d', kind: 'count' },
  { key: 'keptRecordings7d', labelKey: 'summary.keptRecordings7d', kind: 'count' },
  { key: 'bytes7d', labelKey: 'summary.bytes7d', kind: 'bytes' },
  { key: 'sites', labelKey: 'summary.sites', kind: 'count' },
  { key: 'tenants', labelKey: 'summary.tenants', kind: 'count' },
  { key: 'packRevenueCents30d', labelKey: 'summary.packRevenue30d', kind: 'cents' },
];

export default function InsightsOpsPanel() {
  const t = useTranslations('admin.insightsOps');
  const fmt = useFormat();
  const summary = useAdminData<ReplayOpsSummaryDto>(() => replayOpsApi.summary());
  const tenants = useAdminData<AdminTenant[]>(() => adminApi.tenants());
  // The picked workspace, defaulting to the first one listed — derived, not synced by an effect.
  const [chosenTenantId, setTenantId] = useState<number | null>(null);
  const tenantId = chosenTenantId ?? tenants.data?.[0]?.id ?? null;

  const picked = tenants.data?.find((row) => row.id === tenantId) ?? null;

  const tileValue = (kind: 'count' | 'bytes' | 'cents', value: number): string => {
    if (kind === 'bytes') return formatBytes(value);
    if (kind === 'cents') return fmt.money(value / 100, 'USD');
    return fmt.number(value);
  };

  return (
    <div {...REPLAY_BLOCK}>
      <AdminPanelHeader title={t('title')} subtitle={t('subtitle')} onRefresh={summary.reload} />

      <AdminError message={summary.error} />
      <section aria-label={t('summary.aria')} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        {SUMMARY_TILES.map((tile) => (
          <StatTile
            key={tile.key}
            label={t(tile.labelKey)}
            value={summary.data ? tileValue(tile.kind, summary.data[tile.key]) : '—'}
          />
        ))}
      </section>

      <div style={{ maxWidth: 480, marginBottom: 24 }}><SeedMethodFunnelForm /></div>

      <section aria-labelledby="insights-ops-workspace">
        <h3 id="insights-ops-workspace" style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, margin: '0 0 8px', color: 'var(--text-strong)' }}>
          {t('workspace.title')}
        </h3>
        <AdminError message={tenants.error} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <label htmlFor="insights-ops-tenant" style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
            {t('workspace.label')}
          </label>
          <Select
            id="insights-ops-tenant"
            value={tenantId ?? ''}
            disabled={!tenants.data || tenants.data.length === 0}
            onChange={(e) => setTenantId(Number(e.target.value))}
            style={{
              minHeight: 44, maxWidth: '100%', padding: '6px 10px', fontSize: 'var(--font-size-small)',
              background: 'var(--surface-card)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
            }}
          >
            {(tenants.data ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.name} ({row.slug})</option>
            ))}
          </Select>
        </div>
        {tenants.data && tenants.data.length === 0 && (
          <p className="text-muted" style={{ fontSize: 'var(--font-size-small)' }}>{t('workspace.empty')}</p>
        )}

        {picked && (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
            <ReplayTenantSettingsForm key={`settings-${picked.id}`} tenantId={picked.id} />
            <ReplayGrantForm key={`grant-${picked.id}`} tenantId={picked.id} tenantName={picked.name} />
          </div>
        )}
      </section>
    </div>
  );
}
