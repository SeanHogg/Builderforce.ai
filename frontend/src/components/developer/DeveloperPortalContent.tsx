'use client';

/**
 * The Developer Portal (PRD 24 Phase 1) — the one page a vendor uses to become a
 * publisher and ship an extension, and the one a workspace admin uses to see what
 * is installed.
 *
 * ── WHY BOTH AUDIENCES ON ONE PAGE ──────────────────────────────────────────
 * They are the same person in the cases that matter first: the design partners who
 * write the launch catalogue are also customers, and splitting publish from install
 * would mean two routes, two shells and two answers to "where do I go?" before a
 * single third party had registered. The tabs are the split; the route is not.
 *
 * The scope vocabulary and the submittable kinds are FETCHED (`developerApi.contract`)
 * rather than hardcoded here — a client-side copy of the scope list would drift
 * from the server's the first time one was added, and the drifted copy is exactly
 * what a consent screen would render.
 *
 * ── THE PUBLISHER IS THIS WORKSPACE (migration 0472) ────────────────────────
 * There is no publisher picker and no registration form asking for a name and a
 * slug, because a developer is a tenant: the workspace already has both, and
 * asking again is how `/developers/acme` ends up owned by a workspace called
 * something else. Becoming a publisher is one button, and the staff who may act
 * for it are the workspace's members — managed where workspace members have
 * always been managed, not duplicated here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  developerApi,
  type ExtensionContract,
  type ExtensionInstall,
  type ExtensionPackage,
  type ExtensionVersion,
  type InstallPreview,
  type Publisher,
} from '@/lib/builderforceApi';
import { PublishTab } from './PublishTab';
import { PublisherEarningsPanel } from './PublisherEarningsPanel';
// The tokens both halves of this page draw from. Extracted when `PublishTab`
// moved out and the two files started carrying identical copies of them.
import {
  buttonDanger,
  buttonPrimary,
  buttonQuiet,
  card,
  chip,
  grid,
  muted,
  sectionTitle,
} from './portalStyles';

type Tab = 'installed' | 'catalog' | 'publish' | 'earnings';

const TABS = ['installed', 'catalog', 'publish', 'earnings'] as const;

/**
 * Cents → the reader's own currency formatting.
 *
 * Declared once and used by every price on this page. A hand-rolled `${n/100}`
 * is wrong in every locale but one, and a marketplace that shows a French buyer
 * a dollar sign in front of a euro price has told them the wrong number.
 */
function useMoney() {
  const format = useFormatter();
  return (cents: number, currency: string) =>
    format.number(cents / 100, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 });
}

/** `?tab=catalog` opens the portal on the catalogue.
 *
 *  The public `/integrations` page now lists published connectors and MCP servers
 *  alongside our own ports, and its cards have to land somewhere. Without this the
 *  link would drop a buyer on the "installed" tab and make them find the thing they
 *  just clicked. Read from the URL rather than pushed through state so the link is a
 *  plain href that also survives a refresh and a share. */
function initialTab(): Tab {
  if (typeof window === 'undefined') return 'installed';
  const asked = new URLSearchParams(window.location.search).get('tab');
  return (TABS as readonly string[]).includes(asked ?? '') ? (asked as Tab) : 'installed';
}

export function DeveloperPortalContent() {
  const t = useTranslations('developerPortal');
  const tc = useTranslations('common');
  const confirm = useConfirm();

  const money = useMoney();
  const planPrice = (plan: { priceCents: number; interval: string; meteredRateCents: number; unitLabel: string }, currency: string): string =>
    plan.priceCents > 0
      ? t(`catalog.per${plan.interval === 'year' ? 'Year' : 'Month'}` as 'catalog.perMonth', { price: money(plan.priceCents, currency) })
      : t('catalog.perUnit', { price: money(plan.meteredRateCents, currency), unit: plan.unitLabel });

  const [tab, setTab] = useState<Tab>(initialTab);
  const [contract, setContract] = useState<ExtensionContract | null>(null);
  const [publisher, setPublisher] = useState<Publisher | null>(null);
  const [installs, setInstalls] = useState<ExtensionInstall[]>([]);
  const [catalog, setCatalog] = useState<ExtensionPackage[]>([]);
  const [packages, setPackages] = useState<ExtensionPackage[]>([]);
  const [versions, setVersions] = useState<Record<string, ExtensionVersion[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The package whose plan chooser is open, and what installing it would grant.
   *  A paid install cannot go through the one-click door — the plan has to be
   *  chosen before there is anything to charge — so the card expands rather than
   *  the button acting. */
  const [choosing, setChoosing] = useState<{ pkg: ExtensionPackage; preview: InstallPreview } | null>(null);
  const [chosenPlan, setChosenPlan] = useState<string>('');
  /** What the metered period on one install costs so far. Fetched on demand:
   *  most installs are free, and a list that fanned out a usage read per row
   *  would be N requests for a screen most people never look at. */
  const [usage, setUsage] = useState<Record<string, { units: number; unitLabel: string; projectedCents: number; currency: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // One round of parallel reads rather than a waterfall — the portal's four
      // lists are independent, and serialising them would show four spinners.
      const [c, p, i, cat] = await Promise.all([
        developerApi.contract(),
        developerApi.publisher(),
        developerApi.installs(),
        developerApi.catalog(),
      ]);
      setContract(c);
      setPublisher(p);
      setInstalls(i);
      setCatalog(cat);
      setPackages(p ? await developerApi.packages() : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Settle a checkout the processor has just redirected back from.
   *
   * `?extension=<session id>` is what `startPlanCheckout` asked the processor to
   * return with. The id is UNTRUSTED — it arrives from the address bar — and
   * everything that authorises the install is read back from the processor by
   * the server. This only hands it over and clears the query, so a refresh does
   * not try to settle a session that is already settled.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const session = params.get('extension');
    if (!session || session === 'cancelled') return;
    let cancelled = false;
    void (async () => {
      try {
        await developerApi.completePlanCheckout(session);
        if (!cancelled) await load();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('errors.action'));
      } finally {
        params.delete('extension');
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
      }
    })();
    return () => { cancelled = true; };
  }, [load, t]);

  const installedPackageIds = useMemo(
    () => new Set(installs.filter((i) => !i.disabled).map((i) => i.packageId)),
    [installs],
  );

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.action'));
    } finally {
      setBusy(null);
    }
  }

  // ── Install, with the consent step the grant depends on ──────────────────
  async function handleInstall(pkg: ExtensionPackage) {
    const preview = await developerApi.previewInstall(pkg.id);
    // A PAID package cannot take the one-click path: there is a plan to choose
    // and money to move, and the server refuses a free install of it outright.
    // Opening the chooser rather than showing the consent dialogue is what keeps
    // the two flows from looking identical up to the moment one of them fails.
    if (preview.paid) {
      setChoosing({ pkg, preview });
      setChosenPlan(preview.plans[0]?.code ?? '');
      return;
    }
    const ok = await confirm({
      title: t('install.confirmTitle', { name: preview.packageName }),
      message: [
        t('install.confirmPublisher', { publisher: preview.publisherName ?? t('install.unknownPublisher') }),
        t('install.confirmScopes', { scopes: preview.scopes.join(', ') || t('install.noScopes') }),
        preview.sensitiveScopes.length
          ? t('install.confirmSensitive', { scopes: preview.sensitiveScopes.join(', ') })
          : '',
      ].filter(Boolean).join('\n\n'),
      confirmLabel: t('install.confirmAction'),
    });
    if (!ok) return;
    // Partial consent is not a supported state — the server refuses it — so the
    // approved set IS the requested set. The dialogue above is where the person
    // says no; there is no half-yes to encode.
    await run(`install:${pkg.id}`, () => developerApi.install(pkg.id, preview.scopes));
  }

  /**
   * Start a paid install: confirm the scopes AND the price, then hand over.
   *
   * The consent screen says both things because they are one decision. A person
   * approving `write:tickets` and a person agreeing to $9 a month are the same
   * person in the same moment, and splitting them into two dialogues is how one
   * of them gets clicked through.
   */
  async function handleSubscribe() {
    if (!choosing) return;
    const { pkg, preview } = choosing;
    const plan = preview.plans.find((p) => p.code === chosenPlan);
    if (!plan) return;
    const ok = await confirm({
      title: t('install.confirmTitle', { name: preview.packageName }),
      message: [
        t('install.confirmPublisher', { publisher: preview.publisherName ?? t('install.unknownPublisher') }),
        t('install.confirmPrice', { plan: plan.name, price: planPrice(plan, preview.currency) }),
        t('install.confirmScopes', { scopes: preview.scopes.join(', ') || t('install.noScopes') }),
        preview.sensitiveScopes.length
          ? t('install.confirmSensitive', { scopes: preview.sensitiveScopes.join(', ') })
          : '',
        t('install.paidNotice'),
      ].filter(Boolean).join('\n\n'),
      confirmLabel: t('install.confirmSubscribe'),
    });
    if (!ok) return;
    await run(`subscribe:${pkg.id}`, async () => {
      const start = await developerApi.startPlanCheckout({
        packageId: pkg.id,
        planCode: plan.code,
        approvedScopes: preview.scopes,
        returnUrl: window.location.href.split('?')[0] ?? window.location.href,
      });
      setChoosing(null);
      // A pure usage plan on a card-validated workspace has nothing to charge
      // today, so the server installed it outright and there is nowhere to go.
      if (start.checkoutUrl) window.location.assign(start.checkoutUrl);
    });
  }

  async function handleCancelPlan(install: ExtensionInstall) {
    const ok = await confirm({
      title: t('installed.cancelPlanTitle', { name: install.packageName }),
      message: t('installed.cancelPlanBody'),
      confirmLabel: t('installed.cancelPlanAction'),
      destructive: true,
    });
    if (ok) await run(`cancel-plan:${install.id}`, () => developerApi.cancelPlan(install.id));
  }

  async function handleShowUsage(install: ExtensionInstall) {
    const { period } = await developerApi.usage(install.id);
    setUsage((prev) => ({
      ...prev,
      [install.id]: {
        units: period.units,
        unitLabel: period.unitLabel,
        projectedCents: period.projectedCents,
        currency: period.currency,
      },
    }));
  }

  async function handleUninstall(install: ExtensionInstall) {
    const ok = await confirm({
      title: t('installed.uninstallTitle', { name: install.packageName }),
      message: t('installed.uninstallBody'),
      confirmLabel: t('installed.uninstallAction'),
      destructive: true,
    });
    if (ok) await run(`uninstall:${install.id}`, () => developerApi.uninstall(install.id));
  }

  if (loading) {
    return (
      <PageContainer>
        <p style={muted}>{tc('loading')}</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 className="ui-text-section" style={{ color: 'var(--text-primary)', margin: 0 }}>
            {t('title')}
          </h1>
          <p style={{ ...muted, maxWidth: '70ch' }}>{t('subtitle')}</p>
        </header>

        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label={t('tabs.label')}>
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
              style={{
                ...buttonQuiet,
                background: tab === key ? 'var(--surface-interactive)' : 'none',
                fontWeight: tab === key ? 700 : 600,
              }}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </nav>

        {error && (
          <p role="alert" style={{ ...muted, color: 'var(--coral-bright)' }}>{error}</p>
        )}

        {/* ── Installed ──────────────────────────────────────────────── */}
        {tab === 'installed' && (
          <section style={card}>
            <h2 style={sectionTitle}>{t('installed.title')}</h2>
            {installs.length === 0 ? (
              <p style={muted}>{t('installed.empty')}</p>
            ) : (
              <div style={grid}>
                {installs.map((i) => (
                  <article key={i.id} style={{ ...card, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>{i.packageName}</strong>
                      <span style={chip('neutral')}>{i.kind}</span>
                    </div>
                    <p style={muted}>
                      {t('installed.byPublisher', { publisher: i.publisherName ?? '—', version: i.semver })}
                    </p>
                    <p style={muted}>{t('installed.grants', { scopes: i.grantedScopes.join(', ') || '—' })}</p>
                    {i.subscriptionState !== 'none' && (
                      <p style={muted}>
                        {t('installed.plan', { plan: i.planCode ?? '—' })}{' '}
                        <span style={chip(i.subscriptionState === 'active' ? 'good' : 'warn')}>
                          {t(`installed.subscription.${i.subscriptionState}` as 'installed.subscription.active')}
                        </span>
                      </p>
                    )}
                    {usage[i.id] && (
                      <p style={muted}>
                        {t('installed.usage', {
                          units: usage[i.id]!.units,
                          unit: usage[i.id]!.unitLabel,
                          amount: money(usage[i.id]!.projectedCents, usage[i.id]!.currency),
                        })}
                      </p>
                    )}
                    {i.update && (
                      <p style={{ ...muted, color: 'var(--coral-bright)' }}>
                        {i.update.auto
                          ? t('installed.updateAvailable', { version: i.update.semver })
                          : t('installed.updateNeedsConsent', {
                              version: i.update.semver,
                              scopes: i.update.addedScopes.join(', '),
                            })}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {i.update?.auto && (
                        <button
                          type="button"
                          style={buttonPrimary}
                          disabled={busy === `update:${i.id}`}
                          onClick={() => void run(`update:${i.id}`, () => developerApi.updateInstall(i.id))}
                        >
                          {t('installed.update')}
                        </button>
                      )}
                      {i.subscriptionState !== 'none' && (
                        <button type="button" style={buttonQuiet} onClick={() => void handleShowUsage(i)}>
                          {t('installed.viewUsage')}
                        </button>
                      )}
                      {i.subscriptionState !== 'none' && i.subscriptionState !== 'cancelled' && (
                        <button
                          type="button"
                          style={buttonQuiet}
                          disabled={busy === `cancel-plan:${i.id}`}
                          onClick={() => void handleCancelPlan(i)}
                        >
                          {t('installed.cancelPlan')}
                        </button>
                      )}
                      <button
                        type="button"
                        style={buttonDanger}
                        disabled={busy === `uninstall:${i.id}`}
                        onClick={() => void handleUninstall(i)}
                      >
                        {t('installed.uninstall')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Catalog ────────────────────────────────────────────────── */}
        {tab === 'catalog' && (
          <section style={card}>
            <h2 style={sectionTitle}>{t('catalog.title')}</h2>
            {catalog.length === 0 ? (
              <p style={muted}>{t('catalog.empty')}</p>
            ) : (
              <div style={grid}>
                {catalog.map((p) => (
                  <article key={p.id} style={{ ...card, padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>{p.name}</strong>
                      <span style={chip('neutral')}>{p.kind}</span>
                    </div>
                    <p style={muted}>{p.tagline}</p>
                    <p style={muted}>
                      {t('catalog.publisher', { publisher: p.publisher?.name ?? '—' })}{' '}
                      {p.publisher?.state === 'identity_verified' && (
                        <span style={chip('good')}>{t('catalog.verified')}</span>
                      )}
                    </p>
                    <p style={muted}>{t('catalog.installs', { count: p.installCount })}</p>
                    <button
                      type="button"
                      style={buttonPrimary}
                      disabled={installedPackageIds.has(p.id) || busy === `install:${p.id}`}
                      onClick={() => void handleInstall(p)}
                    >
                      {installedPackageIds.has(p.id) ? t('catalog.installed') : t('catalog.install')}
                    </button>

                    {/* The chooser expands the card it belongs to rather than
                        opening a dialogue: the plans have to be COMPARED, and a
                        confirm box that can only hold text cannot show a table. */}
                    {choosing?.pkg.id === p.id && (
                      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <strong style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}>
                          {t('catalog.choosePlan')}
                        </strong>
                        {choosing.preview.plans.map((plan) => (
                          <label key={plan.code} style={{ ...muted, display: 'flex', gap: 8, alignItems: 'flex-start', minHeight: 32 }}>
                            <input
                              type="radio"
                              name={`plan-${p.id}`}
                              value={plan.code}
                              checked={chosenPlan === plan.code}
                              onChange={() => setChosenPlan(plan.code)}
                            />
                            <span>
                              <strong style={{ color: 'var(--text-primary)' }}>{plan.name}</strong>
                              {' — '}
                              {planPrice(plan, choosing.preview.currency)}
                              {plan.meteredRateCents > 0 && plan.priceCents > 0 && (
                                <>
                                  {' · '}
                                  {t('catalog.planIncluded', {
                                    units: plan.includedUnits,
                                    unit: plan.unitLabel,
                                    price: money(plan.meteredRateCents, choosing.preview.currency),
                                  })}
                                </>
                              )}
                            </span>
                          </label>
                        ))}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            style={buttonPrimary}
                            disabled={!chosenPlan || busy === `subscribe:${p.id}`}
                            onClick={() => void handleSubscribe()}
                          >
                            {t('catalog.subscribe')}
                          </button>
                          <button type="button" style={buttonQuiet} onClick={() => setChoosing(null)}>
                            {tc('cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Publish ────────────────────────────────────────────────── */}
        {tab === 'publish' && (
          <PublishTab
            publisher={publisher}
            packages={packages}
            versions={versions}
            contract={contract}
            busy={busy}
            onRun={run}
            onLoadVersions={async (packageId: string) => {
              const v = await developerApi.versions(packageId);
              setVersions((prev) => ({ ...prev, [packageId]: v }));
            }}
          />
        )}

        {/* ── Earnings + programs ────────────────────────────────────── */}
        {tab === 'earnings' && (
          publisher
            ? <PublisherEarningsPanel busy={busy} onRun={run} />
            : <section style={card}><p style={muted}>{t('earnings.notAPublisher')}</p></section>
        )}
      </div>
    </PageContainer>
  );
}
