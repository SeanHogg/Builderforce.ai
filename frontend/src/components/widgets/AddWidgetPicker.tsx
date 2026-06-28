'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { usePermission } from '@/lib/rbac';
import { listWidgetGroups } from '@/lib/widgets/registry';
import { usePins } from '@/lib/widgets/PinsProvider';
import { PinButton } from './PinButton';

/**
 * The widget catalogue — browse every registered widget across the app (grouped
 * by source surface) and pin the ones you want onto your home dashboard. This is
 * the unified picker that absorbs the old scalar metric picker: any widget any
 * surface contributes shows up here, pinnable in one click.
 */
export function AddWidgetPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('widgets');
  const groups = useMemo(() => listWidgetGroups(), []);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  return (
    <SlideOutPanel open={open} onClose={onClose} title={`✛ ${t('addTitle')}`} width="min(640px, 96vw)">
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
        />
        {groups.map((g) => {
          const items = g.widgets.filter((w) => !query || t(`title.${w.titleKey}`).toLowerCase().includes(query));
          if (items.length === 0) return null;
          return (
            <section key={g.group}>
              <h4 style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                {t(`group.${g.group}`)}
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map((w) => (
                  <WidgetRow key={w.id} id={w.id} titleKey={w.titleKey} capability={w.capability} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </SlideOutPanel>
  );
}

function WidgetRow({ id, titleKey, capability }: { id: string; titleKey: string; capability?: string }) {
  const t = useTranslations('widgets');
  const pins = usePins();
  // A widget the user can't access is shown but its pin is disabled via the
  // capability check (never hidden — same product rule as RoleGate).
  const allowed = usePermission((capability ?? 'insights.aiImpact') as Parameters<typeof usePermission>[0]).allowed || !capability;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: pins.isPinned(id) ? 'var(--bg-elevated)' : 'transparent' }}>
      <span style={{ fontSize: '0.86rem', color: 'var(--text-primary)' }}>{t(`title.${titleKey}`)}</span>
      {allowed ? <PinButton widgetKey={id} /> : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>🔒</span>}
    </div>
  );
}
