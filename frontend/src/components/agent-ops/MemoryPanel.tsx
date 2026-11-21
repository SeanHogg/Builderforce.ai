import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { InlineConfirmButton } from '@/components/InlineConfirmButton';
import { LocalCollection } from '@/components/pm/LocalCollection';
import { useProjectScope } from '@/lib/ProjectScopeContext';
import { forgetMemory, isMemoryLapsed, listMemories, purgeExpiredMemories, type GovernedMemory } from '@/lib/agentOpsApi';
import { button, card, cardGrid, emptyState, muted, sectionTitle } from './agentOpsStyles';
import { memoriesDescriptor } from './agentOpsDescriptors';
import { useFormat } from "@/i18n/useFormat";

/**
 * Memory governance — the answer to "what do our agents believe, why, and for how
 * long?".
 *
 * The three columns that did not exist before migration 0371 are the whole point of
 * this view, so they lead: SCOPE (how far a belief travels — and therefore what can
 * contaminate what), ORIGIN (who formed it, so a wrong fact can be traced to the run
 * that invented it) and EXPIRY (whether it is still supposed to be true).
 *
 * It reads through the ACTIVE PROJECT SCOPE, so the list is exactly what an agent
 * running here would recall: the project's facts plus the workspace-wide ones, and
 * never another project's.
 */
export function MemoryPanel() {
  const fmt = useFormat();
  const t = useTranslations('agentOps');
  const confirm = useConfirm();
  const { currentProjectId } = useProjectScope();
  const [rows, setRows] = useState<GovernedMemory[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { memories } = await listMemories({ projectId: currentProjectId });
      setRows(memories);
    } finally {
      setBusy(false);
    }
  }, [currentProjectId]);

  useEffect(() => { void load(); }, [load]);

  const now = Date.now();
  const hasLapsed = useCallback((r: GovernedMemory): boolean => isMemoryLapsed(r, now), [now]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      scoped: list.filter((r) => r.scope !== 'tenant').length,
      expiring: list.filter((r) => r.expiresAt != null && !hasLapsed(r)).length,
      lapsed: list.filter(hasLapsed).length,
    };
  }, [rows, hasLapsed]);

  const onForget = useCallback(async (key: string) => {
    const ok = await confirm({
      title: t('memory.forgetTitle'),
      message: t('memory.forgetConfirm', { key }),
      confirmLabel: t('memory.forget'),
    });
    if (!ok) return;
    await forgetMemory(key, { projectId: currentProjectId });
    await load();
  }, [confirm, t, currentProjectId, load]);

  // Only facts agents already stopped recalling are removed, so no run changes —
  // an inline two-step (InlineConfirmButton), not a destructive modal.
  const onPurge = async () => {
    await purgeExpiredMemories();
    await load();
  };

  const descriptor = useMemo(
    () => memoriesDescriptor(t, fmt, hasLapsed, (m) => void onForget(m.key)),
    [t, fmt, hasLapsed, onForget],
  );

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={cardGrid}>
        <Tile label={t('memory.statTotal')} value={stats.total} hint={t('memory.statTotalHint')} />
        <Tile label={t('memory.statScoped')} value={stats.scoped} hint={t('memory.statScopedHint')} />
        <Tile label={t('memory.statExpiring')} value={stats.expiring} hint={t('memory.statExpiringHint')} />
        <Tile label={t('memory.statLapsed')} value={stats.lapsed} hint={t('memory.statLapsedHint')} tone={stats.lapsed > 0 ? 'warn' : 'neutral'} />
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ ...sectionTitle, marginBottom: 0 }}>{t('memory.tableTitle')}</h2>
          <RoleGate capability="facts.manage">
            <InlineConfirmButton style={button()} onConfirm={onPurge} disabled={busy} hint={t('memory.purgeConfirm')}>
              {t('memory.purge')}
            </InlineConfirmButton>
          </RoleGate>
        </div>

        {rows == null ? (
          <p style={muted}>{t('loading')}</p>
        ) : rows.length === 0 ? (
          <div style={emptyState}>{t('memory.empty')}</div>
        ) : (
          <LocalCollection descriptor={descriptor} rows={rows} searchText={(m) => `${m.key} ${m.content} ${m.origin}`} />
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, hint, tone = 'neutral' }: { label: string; value: number; hint: string; tone?: 'neutral' | 'warn' }) {
  return (
    <div style={card}>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: tone === 'warn' ? 'var(--warning)' : 'var(--text-primary)' }}>
        {value}
      </div>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
      <p style={{ ...muted, marginTop: 4 }}>{hint}</p>
    </div>
  );
}
