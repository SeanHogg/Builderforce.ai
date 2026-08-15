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
 * ── THE PUBLISHER IS THIS WORKSPACE (migration 0471) ────────────────────────
 * There is no publisher picker and no registration form asking for a name and a
 * slug, because a developer is a tenant: the workspace already has both, and
 * asking again is how `/developers/acme` ends up owned by a workspace called
 * something else. Becoming a publisher is one button, and the staff who may act
 * for it are the workspace's members — managed where workspace members have
 * always been managed, not duplicated here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useConfirm } from '@/components/ConfirmProvider';
import {
  developerApi,
  type ExtensionContract,
  type ExtensionInstall,
  type ExtensionPackage,
  type ExtensionVersion,
  type Publisher,
} from '@/lib/builderforceApi';

// ── Tokens only. Every colour here resolves in both themes. ─────────────────
const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--text-primary)',
};

const muted: React.CSSProperties = { fontSize: 12, color: 'var(--text-secondary)' };

const buttonPrimary: React.CSSProperties = {
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--surface-interactive)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  minHeight: 36,
};

const buttonQuiet: React.CSSProperties = {
  ...buttonPrimary,
  background: 'none',
};

const buttonDanger: React.CSSProperties = {
  ...buttonQuiet,
  color: 'var(--coral-bright)',
  borderColor: 'var(--coral-bright)',
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  background: 'var(--bg-elevated, var(--bg-base))',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  minHeight: 36,
};

/** Fluid grid — never a fixed px width that overflows a 360px viewport. */
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
  gap: 14,
};

const chip = (tone: 'neutral' | 'good' | 'warn'): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  fontSize: 11,
  fontWeight: 600,
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--border-subtle)',
  color:
    tone === 'good' ? 'var(--success-text)'
    : tone === 'warn' ? 'var(--coral-bright)'
    : 'var(--text-secondary)',
  whiteSpace: 'nowrap',
});

type Tab = 'installed' | 'catalog' | 'publish';

export function DeveloperPortalContent() {
  const t = useTranslations('developerPortal');
  const tc = useTranslations('common');
  const confirm = useConfirm();

  const [tab, setTab] = useState<Tab>('installed');
  const [contract, setContract] = useState<ExtensionContract | null>(null);
  const [publisher, setPublisher] = useState<Publisher | null>(null);
  const [installs, setInstalls] = useState<ExtensionInstall[]>([]);
  const [catalog, setCatalog] = useState<ExtensionPackage[]>([]);
  const [packages, setPackages] = useState<ExtensionPackage[]>([]);
  const [versions, setVersions] = useState<Record<string, ExtensionVersion[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {t('title')}
          </h1>
          <p style={{ ...muted, maxWidth: '70ch' }}>{t('subtitle')}</p>
        </header>

        <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label={t('tabs.label')}>
          {(['installed', 'catalog', 'publish'] as const).map((key) => (
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
                      <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{i.packageName}</strong>
                      <span style={chip('neutral')}>{i.kind}</span>
                    </div>
                    <p style={muted}>
                      {t('installed.byPublisher', { publisher: i.publisherName ?? '—', version: i.semver })}
                    </p>
                    <p style={muted}>{t('installed.grants', { scopes: i.grantedScopes.join(', ') || '—' })}</p>
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
                      <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{p.name}</strong>
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
            onLoadVersions={async (packageId) => {
              const v = await developerApi.versions(packageId);
              setVersions((prev) => ({ ...prev, [packageId]: v }));
            }}
          />
        )}
      </div>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Publish tab
// ---------------------------------------------------------------------------

type PublishTabProps = {
  publisher: Publisher | null;
  packages: ExtensionPackage[];
  versions: Record<string, ExtensionVersion[]>;
  contract: ExtensionContract | null;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  onLoadVersions: (packageId: string) => Promise<void>;
};

/**
 * Registration, packages and submission.
 *
 * Decides its own visibility rather than being handed a `canPublish` boolean: it
 * knows whether the caller is a member of a publisher, so the consumer does not
 * have to compute it.
 */
function PublishTab({ publisher, packages, versions, contract, busy, onRun, onLoadVersions }: PublishTabProps) {
  const t = useTranslations('developerPortal');
  const [pkgName, setPkgName] = useState('');
  const [pkgKind, setPkgKind] = useState('connector');
  const [specText, setSpecText] = useState('');
  const [semver, setSemver] = useState('1.0.0');
  const [scopes, setScopes] = useState<string[]>(['tools:call']);
  const [target, setTarget] = useState<string>('');
  const [submitResult, setSubmitResult] = useState<ExtensionVersion | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);

  if (!publisher) {
    return (
      <section style={card}>
        <h2 style={sectionTitle}>{t('publish.registerTitle')}</h2>
        <p style={{ ...muted, maxWidth: '70ch' }}>{t('publish.registerBody')}</p>
        <button
          type="button"
          style={buttonPrimary}
          disabled={busy === 'register'}
          onClick={() => void onRun('register', () => developerApi.register())}
        >
          {t('publish.register')}
        </button>
      </section>
    );
  }

  const submit = async () => {
    setSpecError(null);
    let spec: unknown;
    try {
      spec = JSON.parse(specText);
    } catch {
      // Parsed here so a typo is a message beside the field rather than a failed
      // request the publisher has to interpret.
      setSpecError(t('publish.specInvalidJson'));
      return;
    }
    await onRun('submit', async () => {
      const res = await developerApi.submitVersion(target, { semver, spec, requestedScopes: scopes });
      setSubmitResult(res.version);
      await onLoadVersions(target);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <section style={card}>
        <h2 style={sectionTitle}>{t('publish.publisherTitle')}</h2>
        <p style={muted}>
          {publisher.name} · <code>{publisher.slug}</code>{' '}
          <span style={chip(publisher.state === 'identity_verified' ? 'good' : 'neutral')}>
            {t(`publish.verification.${publisher.state}` as 'publish.verification.unverified')}
          </span>
        </p>
        <p style={{ ...muted, maxWidth: '70ch' }}>{t('publish.verificationHint')}</p>
      </section>

      <section style={card}>
        <h2 style={sectionTitle}>{t('publish.newPackageTitle')}</h2>
        <div style={grid}>
          <div>
            <label style={muted} htmlFor="pkg-name">{t('publish.packageName')}</label>
            <input id="pkg-name" style={input} value={pkgName} onChange={(e) => setPkgName(e.target.value)} />
          </div>
          <div>
            <label style={muted} htmlFor="pkg-kind">{t('publish.packageKind')}</label>
            <select id="pkg-kind" style={input} value={pkgKind} onChange={(e) => setPkgKind(e.target.value)}>
              {(contract?.kinds ?? ['connector']).map((k) => (
                // A native <option> needs its own opaque background and foreground:
                // the popup is drawn by the OS and does not inherit the page's theme.
                <option key={k} value={k} style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          style={buttonPrimary}
          disabled={pkgName.trim().length < 2 || busy === 'create-package'}
          onClick={() =>
            void onRun('create-package', () =>
              developerApi.createPackage({ kind: pkgKind, name: pkgName.trim() }),
            )
          }
        >
          {t('publish.createPackage')}
        </button>
      </section>

      <section style={card}>
        <h2 style={sectionTitle}>{t('publish.packagesTitle')}</h2>
        {packages.length === 0 ? (
          <p style={muted}>{t('publish.packagesEmpty')}</p>
        ) : (
          <div style={grid}>
            {packages.map((p) => (
              <article key={p.id} style={{ ...card, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{p.name}</strong>
                  <span style={chip(p.listingState === 'listed' ? 'good' : 'neutral')}>
                    {t(`publish.listing.${p.listingState}` as 'publish.listing.draft')}
                  </span>
                </div>
                <p style={muted}>{p.kind} · <code>{p.slug}</code></p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" style={buttonQuiet} onClick={() => { setTarget(p.id); void onLoadVersions(p.id); }}>
                    {t('publish.selectForSubmit')}
                  </button>
                  {p.listingState === 'listed' && (
                    <button
                      type="button"
                      style={buttonQuiet}
                      disabled={busy === `delist:${p.id}`}
                      onClick={() => void onRun(`delist:${p.id}`, () => developerApi.setListingState(p.id, 'delisted'))}
                    >
                      {t('publish.delist')}
                    </button>
                  )}
                </div>
                {(versions[p.id] ?? []).map((v) => (
                  <div key={v.id} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
                    <p style={muted}>
                      <code>{v.semver}</code>{' '}
                      <span style={chip(v.reviewState === 'approved' ? 'good' : 'warn')}>
                        {t(`publish.review.${v.reviewState}` as 'publish.review.pending')}
                      </span>
                    </p>
                    {v.reviewState === 'approved' && p.currentVersionId !== v.id && (
                      <button
                        type="button"
                        style={buttonPrimary}
                        disabled={busy === `publish:${v.id}`}
                        onClick={() => void onRun(`publish:${v.id}`, () => developerApi.publishVersion(p.id, v.id))}
                      >
                        {t('publish.publishVersion')}
                      </button>
                    )}
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </section>

      {target && (
        <section style={card}>
          <h2 style={sectionTitle}>{t('publish.submitTitle')}</h2>
          <div style={grid}>
            <div>
              <label style={muted} htmlFor="semver">{t('publish.semver')}</label>
              <input id="semver" style={input} value={semver} onChange={(e) => setSemver(e.target.value)} />
            </div>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={muted}>{t('publish.scopes')}</legend>
              {(contract?.scopes ?? []).map((s) => (
                <label key={s} style={{ ...muted, display: 'flex', gap: 8, alignItems: 'center', minHeight: 32 }}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={(e) =>
                      setScopes((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))
                    }
                  />
                  <code>{s}</code>
                </label>
              ))}
            </fieldset>
          </div>
          <label style={muted} htmlFor="spec">{t('publish.spec')}</label>
          <textarea
            id="spec"
            style={{ ...input, minHeight: 220, fontFamily: 'var(--font-mono, monospace)' }}
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
            placeholder={t('publish.specPlaceholder')}
          />
          {specError && <p role="alert" style={{ ...muted, color: 'var(--coral-bright)' }}>{specError}</p>}
          <button type="button" style={buttonPrimary} disabled={busy === 'submit'} onClick={() => void submit()}>
            {t('publish.submit')}
          </button>

          {submitResult && (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
              <p style={{ ...sectionTitle, fontSize: 13 }}>
                {submitResult.reviewState === 'approved' ? t('publish.reviewPassed') : t('publish.reviewFailed')}
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {submitResult.reviewFindings.map((f, idx) => (
                  <li
                    key={`${f.check}-${idx}`}
                    style={{
                      ...muted,
                      color: f.severity === 'fail' ? 'var(--coral-bright)' : 'var(--text-secondary)',
                    }}
                  >
                    <code>{f.check}</code> — {f.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
