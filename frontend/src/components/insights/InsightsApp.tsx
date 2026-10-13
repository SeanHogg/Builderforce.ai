/**
 * The Insights app (`/apps/insights`, PRD 33 §4.2 step 8): a header — site
 * switcher, usage chip, Sites — over THE Insights home.
 *
 * The selected site lives in the address (`?site=`), so a link names the site it
 * is about. The usage chip and Sites open the home's ONE panel on the `plan` and
 * `sites` kinds through the same `?panel=` address a shared link uses; the
 * panel follows its address (`usePanelAddressSync`), so a navigation opens it.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ReplaySiteDto } from '@builderforce/interaction-contract';
import { Button, ButtonLink, SectionError, SectionLoading } from '@/components/ui';
import { InsightsHome } from '@/components/insights/InsightsHome';
import { withPanelParams } from '@/components/insights/panelUrl';
import type { InsightPanelLevel } from '@/components/insights/panelKinds';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { useCapability } from '@/lib/useCapability';
import { CAPABILITY_APPS } from '@/lib/marketplace/capabilityApps';
import styles from './InsightsApp.module.css';

const APP = CAPABILITY_APPS.insights;

export function InsightsApp() {
  const t = useTranslations('apps.insights');
  const router = useRouter();
  const pathname = usePathname() || APP.homePath;
  const search = useSearchParams();
  const { state } = useCapability(APP.listingSlug);
  const [sites, setSites] = useState<ReplaySiteDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    replaySitesApi.list()
      .then((list) => { if (live) setSites(list); })
      .catch((cause: unknown) => { if (live) setError(cause); });
    return () => { live = false; };
  }, []);

  const requested = search?.get('site') ?? null;
  const selected = sites?.find((site) => site.id === requested) ?? sites?.[0] ?? null;

  const navigate = useCallback((mutate: (params: URLSearchParams) => URLSearchParams) => {
    const params = mutate(new URLSearchParams(window.location.search));
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  }, [pathname, router]);

  // Pin the address to the site actually shown, so the link is shareable.
  useEffect(() => {
    if (selected && selected.id !== requested) navigate((params) => { params.set('site', selected.id); return params; });
  }, [selected, requested, navigate]);

  const openPanel = (level: InsightPanelLevel) => {
    if (!selected) return;
    navigate((params) => withPanelParams(params, level));
  };

  if (error) return <SectionError error={error} />;
  if (!sites) return <SectionLoading label={t('loading')} />;
  if (!selected) {
    return (
      <div className={styles.state} data-testid="insights-app-no-site">
        <h1 className={styles.stateTitle}>{t('noSiteTitle')}</h1>
        <p className={styles.stateBody}>{t('noSiteBody')}</p>
        <ButtonLink href={APP.setupPath} variant="primary">{t('setUp')}</ButtonLink>
      </div>
    );
  }

  const usage = state?.usage ?? null;
  const nearLimit = usage ? usage.limit > 0 && usage.used / usage.limit >= 0.8 : false;

  return (
    <div className={styles.app} data-testid="insights-app">
      <header className={styles.header}>
        <h1 className={styles.title}>{t('name')}</h1>
        <label className="sr-only" htmlFor="insights-site">{t('siteLabel')}</label>
        <select
          id="insights-site"
          className={styles.select}
          value={selected.id}
          onChange={(event) => navigate((params) => { params.set('site', event.target.value); return withPanelParams(params, null); })}
        >
          {sites.map((site) => <option key={site.id} value={site.id}>{site.label}</option>)}
        </select>
        {usage && (
          <button
            type="button"
            className={`${styles.chip} ${nearLimit ? styles.chipWarn : ''}`}
            onClick={() => openPanel({ kind: 'plan', id: 'usage' })}
            aria-label={t('usageAria', { used: usage.used.toLocaleString(), limit: usage.limit.toLocaleString() })}
            data-testid="insights-usage-chip"
          >
            {t('usageChip', { used: usage.used.toLocaleString(), limit: usage.limit.toLocaleString() })}
          </button>
        )}
        <Button variant="secondary" onClick={() => openPanel({ kind: 'sites', id: selected.id })}>{t('sites')}</Button>
        <ButtonLink href={APP.setupPath} variant="ghost">{t('addSite')}</ButtonLink>
      </header>
      <InsightsHome key={selected.id} siteId={selected.id} />
    </div>
  );
}
