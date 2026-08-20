'use client';

/**
 * What you get AFTER "publish" — the three things a published site was missing.
 *
 *   <SiteDomainPanel>   put your own domain on it
 *   <SiteFormsPanel>    the endpoint a form posts to, and what people submitted
 *   <SiteTrafficPanel>  whether anyone actually came
 *
 * Each panel decides its OWN visibility: none of them takes a `canShow` prop,
 * and each returns null when the project has no published site. That keeps the
 * host (the Publish tab) from having to know any of their preconditions.
 *
 * All colour comes from theme tokens so both schemes work, and every layout is
 * fluid — these render inside a narrow IDE side panel as often as a wide page.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  siteDataApi,
  siteDomainApi,
  siteTrafficApi,
  type CustomDomainState,
  type SiteCollection,
  type SiteRecord,
  type SiteTrafficSummary,
} from '@/lib/growthApi';
import { useFormat } from "@/i18n/useFormat";

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

const card: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  padding: 'clamp(12px, 3vw, 20px)',
  marginTop: 16,
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const input: React.CSSProperties = {
  flex: '1 1 12rem',
  minWidth: 0,
  padding: '8px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary, var(--bg-elevated))',
  fontSize: 14,
};

const button: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-primary, var(--bg-elevated))',
  fontSize: 14,
  cursor: 'pointer',
  minHeight: 36,
};

const primaryButton: React.CSSProperties = {
  ...button,
  background: 'var(--accent)',
  borderColor: 'var(--accent)',
  color: 'var(--text-on-accent)',
};

/** A copyable DNS value. Monospace and horizontally scrollable — a TXT token
 *  must never wrap or be truncated, or the user pastes a broken record. */
function DnsValue({ children }: { children: string }) {
  return (
    <code
      style={{
        display: 'block',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        padding: '6px 8px',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-2)',
        color: 'var(--text-primary, var(--bg-elevated))',
        border: '1px solid var(--border)',
        fontSize: 12,
      }}
    >
      {children}
    </code>
  );
}

/** Status pill. `tone` drives the colour so the mapping lives in one place. */
function Pill({ tone, children }: { tone: 'ok' | 'pending' | 'bad'; children: React.ReactNode }) {
  const palette = {
    ok: { bg: 'var(--success-bg)', fg: 'var(--success-text)' },
    pending: { bg: 'var(--warning-bg)', fg: 'var(--warning-text)' },
    bad: { bg: 'var(--danger-bg)', fg: 'var(--danger-text)' },
  }[tone];
  return (
    <span style={{
      background: palette.bg, color: palette.fg, borderRadius: 'var(--radius-full)',
      padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function toneForDomain(status: CustomDomainState['status']): 'ok' | 'pending' | 'bad' {
  if (status === 'active') return 'ok';
  if (status === 'failed') return 'bad';
  return 'pending';
}

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

export function SiteDomainPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('site.domain');
  const [state, setState] = useState<CustomDomainState | null>(null);
  const [hostname, setHostname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    siteDomainApi.get(projectId)
      .then((s) => { if (!cancelled) { setState(s); setHostname(s.hostname ?? ''); } })
      .catch(() => { if (!cancelled) setState(null); })
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  const run = useCallback(async (op: () => Promise<CustomDomainState>) => {
    setBusy(true);
    setError('');
    try {
      const next = await op();
      setState(next);
      setHostname(next.hostname ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  // No published site → nothing to put a domain on. The panel hides itself
  // rather than making the Publish tab decide.
  if (!loaded || !state) return null;

  return (
    <section style={card} aria-labelledby="site-domain-heading">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 id="site-domain-heading" style={{ margin: 0, fontSize: 15, color: 'var(--text-primary, var(--bg-elevated))' }}>
          {t('title')}
        </h3>
        {state.hostname && <Pill tone={toneForDomain(state.status)}>{t(`status.${state.status}`)}</Pill>}
      </div>
      <p style={{ margin: '6px 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
        {t('description')}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          style={input}
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('inputLabel')}
          disabled={busy}
        />
        <button
          type="button"
          style={primaryButton}
          disabled={busy || !hostname.trim()}
          onClick={() => run(() => siteDomainApi.claim(projectId, hostname))}
        >
          {state.hostname ? t('update') : t('connect')}
        </button>
        {state.hostname && (
          <>
            <button type="button" style={button} disabled={busy}
              onClick={() => run(() => siteDomainApi.verify(projectId))}>
              {t('verify')}
            </button>
            <button type="button" style={button} disabled={busy}
              onClick={() => run(() => siteDomainApi.release(projectId))}>
              {t('disconnect')}
            </button>
          </>
        )}
      </div>

      {state.instructions && state.status !== 'active' && (
        <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
          <div>
            <div style={label}>{t('txtRecord')}</div>
            <DnsValue>{`TXT  ${state.instructions.txt.name}  →  ${state.instructions.txt.value}`}</DnsValue>
          </div>
          <div>
            <div style={label}>{t('cnameRecord')}</div>
            <DnsValue>{`CNAME  ${state.instructions.cname.name}  →  ${state.instructions.cname.value}`}</DnsValue>
          </div>
        </div>
      )}

      {state.live && state.hostname && (
        <p style={{ marginTop: 12, fontSize: 13 }}>
          <a href={`https://${state.hostname}`} target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)' }}>
            {t('visit', { hostname: state.hostname })}
          </a>
        </p>
      )}

      {/* Verified but the CNAME is missing is the single most common "why is it
          still broken" — say it explicitly rather than leaving them guessing. */}
      {state.status !== 'unset' && state.cnamePointsAtUs === false && (
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--warning-text)' }}>{t('cnameMissing')}</p>
      )}
      {state.error && (
        <p style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>{state.error}</p>
      )}
      {error && (
        <p role="alert" style={{ marginTop: 10, fontSize: 13, color: 'var(--danger-text)' }}>{error}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function SiteFormsPanel({ projectId }: { projectId: number }) {
  const fmt = useFormat();
  const t = useTranslations('site.forms');
  const [collections, setCollections] = useState<SiteCollection[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [records, setRecords] = useState<SiteRecord[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    siteDataApi.listCollections(projectId)
      .then((r) => setCollections(r.collections))
      .catch(() => setCollections(null));
  }, [projectId]);

  useEffect(load, [load]);

  const openCollection = useCallback((id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    setRecords([]);
    siteDataApi.listRecords(projectId, id)
      .then((r) => setRecords(r.records))
      .catch(() => setRecords([]));
  }, [openId, projectId]);

  const create = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await siteDataApi.createCollection(projectId, newName);
      setNewName('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    } finally {
      setBusy(false);
    }
  }, [load, newName, projectId, t]);

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const toggleRaisesTickets = useCallback(async (collection: SiteCollection) => {
    setTogglingId(collection.id);
    setError('');
    try {
      await siteDataApi.updateCollection(projectId, collection.id, { raisesTickets: !collection.raisesTickets });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('genericError'));
    } finally {
      setTogglingId(null);
    }
  }, [load, projectId, t]);

  if (!collections) return null;

  return (
    <section style={card} aria-labelledby="site-forms-heading">
      <h3 id="site-forms-heading" style={{ margin: 0, fontSize: 15, color: 'var(--text-primary, var(--bg-elevated))' }}>
        {t('title')}
      </h3>
      <p style={{ margin: '6px 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
        {t('description')}
      </p>

      <div style={{ display: 'grid', gap: 10 }}>
        {collections.map((collection) => (
          <div key={collection.id} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 12,
            background: 'var(--surface-2)',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 14, color: 'var(--text-primary, var(--bg-elevated))' }}>{collection.name}</strong>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('submissionCount', { count: collection.recordCount })}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={label}>{t('endpoint')}</div>
              <DnsValue>{`POST ${collection.endpoint}`}</DnsValue>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: 'var(--text-primary, var(--bg-elevated))' }}>
              <input
                type="checkbox"
                checked={collection.raisesTickets}
                disabled={togglingId === collection.id}
                onChange={() => toggleRaisesTickets(collection)}
              />
              {t('raisesTickets')}
            </label>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{t('raisesTicketsHint')}</p>
            <button type="button" style={{ ...button, marginTop: 10 }} onClick={() => openCollection(collection.id)}>
              {openId === collection.id ? t('hideSubmissions') : t('viewSubmissions')}
            </button>

            {openId === collection.id && (
              <div style={{ marginTop: 10, overflowX: 'auto' }}>
                {records.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('noSubmissions')}</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: '28rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: 6, color: 'var(--text-muted)' }}>{t('when')}</th>
                        <th style={{ textAlign: 'left', padding: 6, color: 'var(--text-muted)' }}>{t('email')}</th>
                        <th style={{ textAlign: 'left', padding: 6, color: 'var(--text-muted)' }}>{t('fields')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => (
                        <tr key={record.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 6, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                            {fmt.dateTime(record.createdAt)}
                          </td>
                          <td style={{ padding: 6, color: 'var(--text-primary, var(--bg-elevated))' }}>{record.email ?? '—'}</td>
                          <td style={{ padding: 6, color: 'var(--text-primary, var(--bg-elevated))' }}>
                            {Object.entries(record.payload).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <input
          style={input}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('newPlaceholder')}
          aria-label={t('newLabel')}
          disabled={busy}
        />
        <button type="button" style={button} disabled={busy || !newName.trim()} onClick={create}>
          {t('add')}
        </button>
      </div>
      {error && (
        <p role="alert" style={{ marginTop: 10, fontSize: 13, color: 'var(--danger-text)' }}>{error}</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Traffic
// ---------------------------------------------------------------------------

export function SiteTrafficPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('site.traffic');
  const [summary, setSummary] = useState<SiteTrafficSummary | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);

  useEffect(() => {
    let cancelled = false;
    siteTrafficApi.get(projectId, days)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [projectId, days]);

  if (!summary) return null;

  const peak = Math.max(1, ...summary.days.map((d) => d.pageViews));

  return (
    <section style={card} aria-labelledby="site-traffic-heading">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 id="site-traffic-heading" style={{ margin: 0, fontSize: 15, color: 'var(--text-primary, var(--bg-elevated))' }}>
          {t('title')}
        </h3>
        <div style={{ display: 'flex', gap: 4 }}>
          {([7, 30, 90] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              aria-pressed={days === option}
              style={{
                ...button,
                padding: '4px 10px',
                minHeight: 30,
                fontSize: 12,
                background: days === option ? 'var(--accent)' : 'var(--surface-2)',
                color: days === option ? 'var(--text-on-accent)' : 'var(--text-primary, var(--bg-elevated))',
                borderColor: days === option ? 'var(--accent)' : 'var(--border)',
              }}
            >
              {t('window', { days: option })}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        display: 'grid', gap: 10, marginTop: 12,
        gridTemplateColumns: 'repeat(auto-fit, minmax(7rem, 1fr))',
      }}>
        <Stat label={t('views')} value={summary.totals.pageViews} />
        <Stat label={t('visitors')} value={summary.totals.visitors} />
        <Stat label={t('assets')} value={summary.totals.assetHits} />
      </div>

      {summary.days.length > 0 && (
        // A sparkline rather than a chart library: the question here is "is the
        // line going up", and a dependency-free bar row answers it at any width.
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 48, marginTop: 14 }}
          role="img" aria-label={t('sparklineLabel')}>
          {[...summary.days].reverse().map((day) => (
            <div
              key={day.day}
              title={`${day.day}: ${day.pageViews}`}
              style={{
                flex: 1,
                minWidth: 2,
                height: `${Math.max(4, (day.pageViews / peak) * 100)}%`,
                background: 'var(--accent)',
                borderRadius: 'var(--radius-sm)',
                opacity: 0.85,
              }}
            />
          ))}
        </div>
      )}

      <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        {t('approximate')}
      </p>
    </section>
  );
}

function Stat({ label: name, value }: { label: string; value: number }) {
  const fmt = useFormat();
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 10,
      background: 'var(--surface-2)',
    }}>
      <div style={label}>{name}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary, var(--bg-elevated))' }}>
        {fmt.number(value)}
      </div>
    </div>
  );
}
