/**
 * REGISTRATION, PACKAGES, PRICING AND SUBMISSION — the publisher half of the portal.
 *
 * Extracted from `DeveloperPortalContent` when the paid-install flow carried that
 * file past the 800-line architecture ratchet. This is the natural seam rather than
 * a convenient one: it is a whole audience's half of the page, it was already a
 * self-contained component, and it already decides its own visibility from the
 * publisher it is handed rather than taking a `canPublish` flag its consumer would
 * have to compute.
 *
 * ── NO `use client` DIRECTIVE, DELIBERATELY ─────────────────────────────────
 * Imported only by `DeveloperPortalContent`, which is already the boundary. A module
 * imported by a client module IS client code either way, so the directive would mark
 * nothing and change nothing except the ratchet's count — the finding its own
 * changelog records three separate times.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  developerApi,
  type ExtensionContract,
  type ExtensionPackage,
  type ExtensionVersion,
  type Publisher,
} from '@/lib/builderforceApi';
import { ExtensionPlansEditor } from './ExtensionPlansEditor';
import {
  buttonPrimary,
  buttonQuiet,
  card,
  chip,
  grid,
  input,
  muted,
  sectionTitle,
} from './portalStyles';

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
export function PublishTab({ publisher, packages, versions, contract, busy, onRun, onLoadVersions }: PublishTabProps) {
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
                  <strong style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}>{p.name}</strong>
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
                {/* The price list lives on the package it prices. Rendered only
                    for the package a publisher has selected, so a workspace with
                    twenty listings does not fetch twenty price lists to look at one. */}
                {target === p.id && (
                  <ExtensionPlansEditor
                    packageId={p.id}
                    publisherState={publisher.state}
                    busy={busy}
                    onRun={onRun}
                  />
                )}
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
              <p style={{ ...sectionTitle, fontSize: 'var(--font-size-small)' }}>
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
