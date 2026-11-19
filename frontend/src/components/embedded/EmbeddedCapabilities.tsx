'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { replaySnippets } from '@builderforce/interaction-contract';
import { EmbeddedStackValue } from '@/components/embedded/EmbeddedStackValue';
import { InsightsSiteNote } from '@/components/embedded/InsightsSiteNote';
import { useInsightsSite } from '@/components/embedded/useInsightsSite';
import { EmbedIntegrationSettings } from '@/components/settings/EmbedIntegrationSettings';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { Icon } from '@/components/ui/Icon';
import { useAuth } from '@/lib/AuthContext';
import { usePermission } from '@/lib/rbac';
import { embedApi, type CustomerEmbedFeatureKey, type EmbedConfigResult } from '@/lib/builderforceApi';
import { capabilitySnippet, EMBEDDED_CAPABILITIES, unifiedEmbedSnippet, type EmbeddedCapabilityCategory } from '@/lib/embeddedCapabilities';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import { Collection } from '@/components/collection/Collection';
import { useLocalSource } from '@/components/collection/sources';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { usePublishReferenceChrome, usePublishReferenceSelect, useReferenceRailActive } from '@/lib/referenceChrome';
import styles from './EmbeddedCapabilities.module.css';
import { useFormat } from "@/i18n/useFormat";

const TABS = ['features', 'install', 'consent', 'surfaces'] as const;

/**
 * Capabilities whose runtime needs more than the toggle, with the note that says
 * what. Heatmaps record only when the install tag carries an Insights site key.
 */
const CAPABILITY_NOTES: Partial<Record<CustomerEmbedFeatureKey, ComponentType<{ siteKey: string | null }>>> = {
  heatmaps: InsightsSiteNote,
};

function CapabilityNote({ capability, siteKey }: { capability: CustomerEmbedFeatureKey; siteKey: string | null }) {
  const Note = CAPABILITY_NOTES[capability];
  return Note ? <Note siteKey={siteKey} /> : null;
}
type Tab = (typeof TABS)[number];
type Filter = 'all' | EmbeddedCapabilityCategory;

export function EmbeddedCapabilities() {
  const fmt = useFormat();
  const t = useTranslations('embedded');
  const { isAuthenticated, tenantToken } = useAuth();
  const { allowed: canManage } = usePermission('embed.manage');
  const [tab, setTab] = useState<Tab>('features');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [config, setConfig] = useState<EmbedConfigResult | null>(null);
  const [pending, setPending] = useState<CustomerEmbedFeatureKey | null>(null);
  const [saving, setSaving] = useState<CustomerEmbedFeatureKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = useCopyToClipboard();
  const { siteKey } = useInsightsSite();
  const installTag = unifiedEmbedSnippet(config?.publicKey ?? 'bf_WORKSPACE_KEY', siteKey);

  useEffect(() => {
    // /api/embed/config is tenant-scoped. A person-level session can exist for a
    // render before the shell has selected/exchanged a workspace JWT; calling in
    // that gap produces a guaranteed 401 with no Authorization header.
    if (!tenantToken) return;
    let cancelled = false;
    embedApi.getConfig()
      .then((value) => { if (!cancelled) setConfig(value); })
      .catch(() => { if (!cancelled) setError(t('loadError')); });
    return () => { cancelled = true; };
  }, [t, tenantToken]);

  // `null` — not 0 — when no workspace config has resolved. They are different
  // facts and the hero renders them differently: a signed-out visitor was being
  // shown "0/13 capabilities active" as the lead metric of a public marketing
  // page, which reads as an empty product rather than an unconnected workspace.
  const activeCount = config
    ? Object.values(config.customerFeatures).filter((item) => item.enabled).length
    : null;
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

  // §11.4.5 — signed in, this page opens as a panel over the board, so it names
  // itself for the panel header and hands over its four views as the index rail.
  // Its sections are TABS rather than anchors (only one is in the DOM at a
  // time), so the rail switches instead of scrolling. Both calls are no-ops on
  // the signed-out page render, where there is no panel and no provider.
  usePublishReferenceChrome({
    title: t('title'),
    sections: TABS.map((item) => ({ id: item, label: t(`tabs.${item}`) })),
    activeId: tab,
  });
  usePublishReferenceSelect((id) => setTab(id as Tab));
  // In a panel the rail IS this tablist, so rendering both put the same four
  // choices on screen twice. Signed out — the page render — there is no rail and
  // the tablist is the only way to change view, so it stays.
  const railHasTabs = useReferenceRailActive();

  const filters: Filter[] = ['all', 'engage', 'measure', 'govern', 'operate'];

  // The ONE Collection (PRD 47): the capability catalog is a static in-memory
  // list → local source. entity: null — a read-only catalog (no selection / bulk
  // bar); the per-row switch is the only mutation. Search + category filters keep
  // their page-level state and feed the source.
  type Capability = (typeof EMBEDDED_CAPABILITIES)[number];
  // requestToggle is recreated every render; the memoized descriptor calls it
  // through a ref so a click never runs a stale closure.
  const requestToggleRef = useRef(requestToggle);
  useEffect(() => { requestToggleRef.current = requestToggle; });
  const capabilitiesDescriptor = useMemo<CollectionDescriptor<Capability>>(() => {
  const capName = (item: Capability) => t(`features.${item.key}.name`);
  const capSwitch = (item: Capability) => {
    const state = config?.customerFeatures[item.key];
    return <button type="button" role="switch" aria-checked={state?.enabled ?? false} aria-label={t('toggleLabel', { feature: capName(item) })} className={`${styles.switch} ${state?.enabled ? styles.switchOn : ''}`} disabled={!config || !canManage || saving === item.key} onClick={() => requestToggleRef.current(item.key)} />;
  };
  return {
    entity: null,
    surfaceKey: 'embedded.capabilities',
    rowId: (item) => item.key,
    label: capName,
    defaultView: 'card',
    defaultSort: { key: 'name', dir: 'asc' },
    emptyKey: 'emptyEmbeddedCapabilities',
    columns: [
      { key: 'name', header: t('columns.capability'), sortKey: 'name', compare: (a, b) => capName(a).localeCompare(capName(b)), cell: capName },
      { key: 'category', header: t('columns.category'), sortKey: 'category', compare: (a, b) => a.category.localeCompare(b.category), cell: (item) => <span className={styles.badge}>{t(`categories.${item.category}`)}</span> },
      { key: 'replaces', header: t('columns.replaces'), cell: (item) => item.replaces.join(' · ') },
      { key: 'examples', header: t('columns.examples'), sortKey: 'examples', compare: (a, b) => a.examples - b.examples, cell: (item) => item.examples },
      { key: 'enabled', header: t('columns.enabled'), align: 'end', cell: capSwitch },
    ],
    card: (item) => (
      <article className={styles.card} key={item.key} style={{ border: 'none' }}>
        <div className={styles.cardIcon}><Icon source={item.icon} size={20} /></div>
        <div>
          <h3>{capName(item)}</h3>
          <p>{t(`features.${item.key}.description`)}</p>
          {/* What a team buys INSTEAD of this row — the worth, not just the function. */}
          <p className={styles.replaces}>{t('replaces', { tools: item.replaces.join(' · ') })}</p>
          <div className={styles.meta}>
            <span className={styles.badge}>{t(`categories.${item.category}`)}</span>
            <span>{t('examples', { count: item.examples })}</span>
          </div>
          <CapabilityNote capability={item.key} siteKey={siteKey} />
        </div>
        {capSwitch(item)}
      </article>
    ),
  };
  }, [t, config, canManage, saving, siteKey]);
  const capabilitiesSource = useLocalSource(visible, capabilitiesDescriptor, { key: 'name', dir: 'asc' }, { page: 1, pageSize: 250 });

  return <div className={styles.page}>
    <section className={styles.hero}>
      <div>
        <div className={styles.eyebrow}>{t('eyebrow')}</div>
        <h1>{t('title')}</h1>
        <p>{t('subtitle')}</p>
        <Link className={styles.canvasLink} href="/create">{t('openCanvas')} <span aria-hidden="true">→</span></Link>
      </div>
      <div className={styles.heroMetric}>
        {activeCount === null
          ? <><strong>{EMBEDDED_CAPABILITIES.length}</strong><span>{t('availableCapabilities')}</span></>
          : <><strong>{activeCount}/{EMBEDDED_CAPABILITIES.length}</strong><span>{t('activeCapabilities')}</span></>}
      </div>
    </section>

    {!railHasTabs && <div className={styles.tabs} role="tablist" aria-label={t('tabsLabel')}>
      {TABS.map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} className={`${styles.tab} ${tab === item ? styles.tabActive : ''}`} onClick={() => setTab(item)}>{t(`tabs.${item}`)}</button>)}
    </div>}

    {error && <div className={styles.error} role="alert">{error}</div>}
    {/* "Select a workspace" is an instruction, and an anonymous visitor has no
        workspace to select — for them this page is a marketing page, and the
        pitch below is the honest answer to "what is this?". */}
    {isAuthenticated && !tenantToken && <div className={styles.notice} role="status">{t('selectWorkspace')}</div>}

    {tab === 'features' && <>
      <EmbeddedStackValue activeCount={activeCount} onShowInstall={() => setTab('install')} />
      <Collection descriptor={capabilitiesDescriptor} source={capabilitiesSource} search={search} onSearchChange={setSearch}>
        {filters.map((item) => <button key={item} type="button" className={`${styles.filter} ${filter === item ? styles.filterActive : ''}`} onClick={() => setFilter(item)}>{t(`categories.${item}`)}</button>)}
      </Collection>
    </>}

    {tab === 'install' && <section className={styles.panel}>
      <h2>{t('install.title')}</h2><p className={styles.panelIntro}>{t('install.description')}</p>
      <pre className={styles.code}>{installTag}</pre>
      <button type="button" className={styles.copy} onClick={() => void copy.copy(installTag)}>{copy.copied ? t('copied') : t('copySnippet')}</button>
      <InsightsSiteNote siteKey={siteKey} />
      {/* The same Insights site on its own, for a site that wants replay without the widgets. */}
      {siteKey && <div style={{ marginTop: 18 }}><h3>{t('insights.standaloneTitle')}</h3><pre className={styles.code}>{replaySnippets({ siteKey }).scriptTag}</pre></div>}
      {/* Only a capability whose runtime ships a page API has a snippet (`capabilitySnippet`). */}
      {config && EMBEDDED_CAPABILITIES.filter((item) => config.customerFeatures[item.key]?.enabled && capabilitySnippet(item.key) !== null).map((item) => <div key={item.key} style={{ marginTop: 18 }}><h3>{t(`features.${item.key}.name`)}</h3><pre className={styles.code}>{capabilitySnippet(item.key)}</pre></div>)}
    </section>}

    {tab === 'consent' && <section className={styles.panel}>
      <h2>{t('consent.title')}</h2><p className={styles.panelIntro}>{t('consent.description')}</p>
      <div className={styles.consentList}>
        {config?.customerConsentLog.map((event, index) => <div className={styles.consentRow} key={`${event.feature}-${event.at}-${index}`}><strong>{t(`features.${event.feature}.name`)}</strong><span>{t(`consent.actions.${event.action}`)}</span><span>{fmt.dateTime(event.at)}</span><span>{event.by}</span></div>)}
        {config?.customerConsentLog.length === 0 && <div className={styles.empty}>{t('consent.empty')}</div>}
      </div>
    </section>}

    {tab === 'surfaces' && <EmbedIntegrationSettings />}

    {pending && <SlideOutPanel open onClose={() => setPending(null)} title={t('consent.enableTitle', { feature: t(`features.${pending}.name`) })} width="sheet" widthStorageKey="embedded-consent">
      <div className={styles.consentBody}><p>{t(`features.${pending}.consent`)}</p><p>{t('consent.auditNotice', { version: config?.customerConsentRequiredVersion ?? 1 })}</p><div className={styles.consentActions}><button type="button" className={styles.secondary} onClick={() => setPending(null)}>{t('cancel')}</button><button type="button" className={styles.primary} onClick={() => void setFeature(pending, true, true)}>{t('consent.agree')}</button></div></div>
    </SlideOutPanel>}
  </div>;
}
