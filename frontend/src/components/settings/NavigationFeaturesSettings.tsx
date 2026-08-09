'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { NAV_GROUPS } from '@/lib/navGroups';
import { NAVIGATION_FEATURE_IDS, type NavigationFeatureId } from '@/lib/navigationFeatures';
import { useNavigationFeatures } from '@/lib/NavigationFeaturesContext';
import { Button } from '@/components/ui';
import { NavIcon } from '@/components/navigation/NavIcon';
import { useConsumption } from '@/lib/useConsumption';
import { ConsumptionMeterCard } from '@/components/UsageMeter';

const RECOMMENDED: readonly NavigationFeatureId[] = [
  'seat', 'projects', 'workforce', 'insights', 'knowledge',
];

export default function NavigationFeaturesSettings() {
  const t = useTranslations('settings.navigationFeatures');
  const tn = useTranslations('nav');
  const tp = useTranslations('planBadge.tier');
  const { enabledIds, loading, save } = useNavigationFeatures();
  const consumption = useConsumption();
  const [selected, setSelected] = useState<NavigationFeatureId[]>(enabledIds);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => { setSelected(enabledIds); }, [enabledIds]);

  const modules = useMemo(() => NAVIGATION_FEATURE_IDS.map((id) => {
    const group = NAV_GROUPS.find((candidate) => candidate.id === id);
    if (!group) throw new Error(`Missing navigation group for feature ${id}`);
    return { id, group };
  }), []);

  const select = (id: NavigationFeatureId) => {
    setNotice('');
    setSelected((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id)
      : NAVIGATION_FEATURE_IDS.filter((candidate) => candidate === id || current.includes(candidate)));
  };

  const submit = async () => {
    setSaving(true);
    setNotice('');
    try {
      await save(selected);
      setNotice(t('saved'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>{t('title')}</h2>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)', maxWidth: 640 }}>{t('description')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('selectedCount', { selected: selected.length, total: modules.length })}
          </span>
          <button type="button" className="btn-ghost" onClick={() => setSelected([...RECOMMENDED])}>{t('recommended')}</button>
          <button type="button" className="btn-ghost" onClick={() => setSelected([...NAVIGATION_FEATURE_IDS])}>{t('all')}</button>
          <button type="button" className="btn-ghost" onClick={() => setSelected([])}>{t('clear')}</button>
          <Button variant="primary" onClick={() => void submit()} loading={saving} disabled={loading}>{t('save')}</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 20 }}>
        {modules.map(({ id, group }) => {
          const checked = selected.includes(id);
          return (
            <label
              key={id}
              style={{
                display: 'grid', gridTemplateColumns: '20px 28px 1fr', alignItems: 'start', gap: 10,
                padding: 14, cursor: 'pointer', borderRadius: 'var(--radius-md)',
                border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-subtle)'}`,
                background: checked ? 'var(--surface-interactive)' : 'var(--bg-elevated)',
              }}
            >
              <input type="checkbox" checked={checked} onChange={() => select(id)} aria-label={tn(group.labelKey)} style={{ marginTop: 3 }} />
              <span style={{ fontSize: 18, lineHeight: 1.2 }}><NavIcon name={id} /></span>
              <span>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{tn(group.labelKey)}</span>
                <span style={{ display: 'block', marginTop: 4, fontSize: 11, lineHeight: 1.45, color: 'var(--text-muted)' }}>{t(`descriptions.${id}`)}</span>
              </span>
            </label>
          );
        })}
      </div>
      {notice && <p role="status" style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{notice}</p>}

      {consumption && (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)' }}>{t('usageTitle')}</h3>
              <p style={{ margin: '5px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                {t('usageDescription', { plan: tp(consumption.plan.effective) })}
              </p>
            </div>
            <Link
              href={`/pricing?features=${selected.join(',')}`}
              style={{ fontSize: 12, fontWeight: 700, color: 'var(--coral-bright)', textDecoration: 'none' }}
            >
              {t('comparePlans')} →
            </Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
            {consumption.meters.map((meter) => (
              <ConsumptionMeterCard key={meter.key} meter={meter} isFree={consumption.plan.effective === 'free'} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
