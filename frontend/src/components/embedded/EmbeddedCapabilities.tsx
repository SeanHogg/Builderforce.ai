'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { EmbedIntegrationSettings } from '@/components/settings/EmbedIntegrationSettings';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Icon } from '@/components/ui/Icon';
import { getStoredTenant } from '@/lib/auth';
import { embedApi, type CustomerEmbedFeatureKey, type EmbedConfigResult } from '@/lib/builderforceApi';
import { capabilitySnippet, EMBEDDED_CAPABILITIES, unifiedEmbedSnippet, type EmbeddedCapabilityCategory } from '@/lib/embeddedCapabilities';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import styles from './EmbeddedCapabilities.module.css';

type Tab = 'features' | 'install' | 'consent' | 'surfaces';
type Filter = 'all' | EmbeddedCapabilityCategory;

export function EmbeddedCapabilities() {
  const t = useTranslations('embedded');
  const [tab, setTab] = useState<Tab>('features');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [config, setConfig] = useState<EmbedConfigResult | null>(null);
  const [pending, setPending] = useState<CustomerEmbedFeatureKey | null>(null);
  const [saving, setSaving] = useState<CustomerEmbedFeatureKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = useCopyToClipboard();
  const role = getStoredTenant()?.role;
  const canManage = role === 'owner' || role === 'manager';

  useEffect(() => {
    let cancelled = false;
    embedApi.getConfig()
      .then((value) => { if (!cancelled) setConfig(value); })
      .catch(() => { if (!cancelled) setError(t('loadError')); });
    return () => { cancelled = true; };
  }, [t]);

  const activeCount = config
    ? Object.values(config.customerFeatures).filter((item) => item.enabled).length
    : 0;
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return EMBEDDED_CAPABILITIES.filter((item) => {
      if (filter !== 'all' && item.category !== filter) return false;
      if (!needle) return true;
      return `${t(`features.${item.key}.name`)} ${t(`features.${item.key}.description`)}`.toLocaleLowerCase().includes(needle);
    });
  }, [filter, search, t]);

  const setFeature = async (key: CustomerEmbedFeatureKey, enabled: boolean, consentAcknowledged = false) => {
    setSaving(key);
    setError(null);
    try {
      const result = await embedApi.setFeature(key, { enabled, consentAcknowledged });
      setConfig((current) => current ? {
        ...current,
        customerFeatures: { ...current.customerFeatures, [key]: result },
        customerConsentLog: current.customerFeatures[key]?.enabled === enabled
          ? current.customerConsentLog
          : [{ feature: key, action: enabled ? 'OPT_IN' : 'OPT_OUT', version: result.consentVersion ?? current.customerConsentRequiredVersion, at: new Date().toISOString(), by: result.consentedBy ?? '' }, ...current.customerConsentLog],
      } : current);
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(null);
      setPending(null);
    }
  };

  const requestToggle = (key: CustomerEmbedFeatureKey) => {
    if (!config || !canManage) return;
    const current = config.customerFeatures[key];
    if (current.enabled) void setFeature(key, false);
    else if (current.consentVersion === config.customerConsentRequiredVersion) void setFeature(key, true);
    else setPending(key);
  };

  const tabs: Tab[] = ['features', 'install', 'consent', 'surfaces'];
  const filters: Filter[] = ['all', 'engage', 'measure', 'govern', 'operate'];

  return <div className={styles.page}>
    <section className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>{t('eyebrow')}</div>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
        <Link className={styles.canvasLink} href="/create">{t('openCanvas')} <span aria-hidden="true">→</span></Link>
      </div>
      <div className={styles.heroMetric}>
        <strong>{activeCount}/{EMBEDDED_CAPABILITIES.length}</strong>
        <span>{t('activeCapabilities')}</span>
      </div>
    </section>

    <div className={styles.tabs} role="tablist" aria-label={t('tabsLabel')}>
      {tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={`${styles.tab} ${tab === item ? styles.tabActive : ''}`} onClick={() => setTab(item)}>{t(`tabs.${item}`)}</button>)}
    </div>

    {error && <div className={styles.error} role="alert">{error}</div>}

    {tab === 'features' && <>
      <div className={styles.toolbar}>
        <input className={styles.search} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('search')} aria-label={t('search')} />
        {filters.map((item) => <button key={item} type="button" className={`${styles.filter} ${filter === item ? styles.filterActive : ''}`} onClick={() => setFilter(item)}>{t(`categories.${item}`)}</button>)}
      </div>
      <div className={styles.grid}>
        {visible.map((item) => {
          const state = config?.customerFeatures[item.key];
          return <article className={styles.card} key={item.key}>
            <div className={styles.cardIcon}><Icon source={item.icon} size={20} /></div>
            <div>
              <h3>{t(`features.${item.key}.name`)}</h3>
              <p>{t(`features.${item.key}.description`)}</p>
              <div className={styles.meta}>
                <span className={styles.badge}>{t(`categories.${item.category}`)}</span>
                <span>{t('examples', { count: item.examples })}</span>
              </div>
            </div>
            <button type="button" role="switch" aria-checked={state?.enabled ?? false} aria-label={t('toggleLabel', { feature: t(`features.${item.key}.name`) })} className={`${styles.switch} ${state?.enabled ? styles.switchOn : ''}`} disabled={!config || !canManage || saving === item.key} onClick={() => requestToggle(item.key)} />
          </article>;
        })}
      </div>
    </>}

    {tab === 'install' && <section className={styles.panel}>
      <h2>{t('install.title')}</h2><p className={styles.panelIntro}>{t('install.description')}</p>
      <pre className={styles.code}>{unifiedEmbedSnippet(config?.publicKey ?? 'bf_WORKSPACE_KEY')}</pre>
      <button type="button" className={styles.copy} onClick={() => void copy.copy(unifiedEmbedSnippet(config?.publicKey ?? 'bf_WORKSPACE_KEY'))}>{copy.copied ? t('copied') : t('copySnippet')}</button>
      {config && EMBEDDED_CAPABILITIES.filter((item) => config.customerFeatures[item.key]?.enabled).map((item) => <div key={item.key} style={{ marginTop: 18 }}><h3>{t(`features.${item.key}.name`)}</h3><pre className={styles.code}>{capabilitySnippet(item.key)}</pre></div>)}
    </section>}

    {tab === 'consent' && <section className={styles.panel}>
      <h2>{t('consent.title')}</h2><p className={styles.panelIntro}>{t('consent.description')}</p>
      <div className={styles.consentList}>
        {config?.customerConsentLog.map((event, index) => <div className={styles.consentRow} key={`${event.feature}-${event.at}-${index}`}><strong>{t(`features.${event.feature}.name`)}</strong><span>{t(`consent.actions.${event.action}`)}</span><span>{new Date(event.at).toLocaleString()}</span><span>{event.by}</span></div>)}
        {config?.customerConsentLog.length === 0 && <div className={styles.empty}>{t('consent.empty')}</div>}
      </div>
    </section>}

    {tab === 'surfaces' && <EmbedIntegrationSettings />}

    {pending && <SlideOutPanel open onClose={() => setPending(null)} title={t('consent.enableTitle', { feature: t(`features.${pending}.name`) })} width="min(560px, 96vw)">
      <div className={styles.consentBody}><p>{t(`features.${pending}.consent`)}</p><p>{t('consent.auditNotice', { version: config?.customerConsentRequiredVersion ?? 1 })}</p><div className={styles.consentActions}><button type="button" className={styles.secondary} onClick={() => setPending(null)}>{t('cancel')}</button><button type="button" className={styles.primary} onClick={() => void setFeature(pending, true, true)}>{t('consent.agree')}</button></div></div>
    </SlideOutPanel>}
  </div>;
}
