'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import HandlerEditor from '@/components/HandlerEditor';
import {
  projectBackendApi,
  type HandlerSpecDocument,
  type ProjectBackendRequestRow,
  type ProjectBackendView,
} from '@/lib/builderforceApi';

/**
 * The operating surface for a project's server-side half.
 *
 * It exists because a BUILT system is not a WORKING one: the endpoints are live
 * the moment they are saved, but they fail closed until the signature-verification
 * secret is stored and the provider is pointed at the right URL. This panel is
 * where those two things get done and where the answer to "did anything actually
 * reach us?" lives — otherwise the only place to look is the provider's console.
 *
 * The secret form deliberately has no read-back: the vault has no read path, so
 * the field always starts empty and storing a value replaces it. The masked hint
 * is how a human tells WHICH token is stored.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 20,
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 8,
};

const code: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 12.5,
  color: 'var(--text-primary)',
  background: 'var(--surface-sunken, transparent)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '3px 7px',
  wordBreak: 'break-all',
};

const input: React.CSSProperties = {
  flex: '1 1 200px',
  minWidth: 0,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated, transparent)',
  color: 'var(--text-primary)',
  fontSize: 14,
};

const button: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--text-primary)',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
};

/** Verdict → theme-token colour. Both themes get the variable, with a literal
 *  fallback so an unset token still reads. */
const VERDICT_COLOR: Record<string, string> = {
  ok: 'var(--success, #167a4a)',
  unverified: 'var(--warning, #9a6200)',
  'no-handler': 'var(--warning, #9a6200)',
  'rate-limited': 'var(--warning, #9a6200)',
  error: 'var(--danger, #b3261e)',
};

export default function ProjectBackendPanel({ projectId }: { projectId: number }) {
  const t = useTranslations('challenges.backend');

  const [view, setView] = useState<ProjectBackendView | null>(null);
  const [requests, setRequests] = useState<ProjectBackendRequestRow[]>([]);
  const [secretName, setSecretName] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `null` = closed; `{ name: null }` = creating; otherwise editing that handler. */
  const [editing, setEditing] = useState<{ name: string | null; spec: HandlerSpecDocument | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, rows] = await Promise.all([
        projectBackendApi.get(projectId),
        projectBackendApi.requests(projectId),
      ]);
      setView(next);
      setRequests(rows);
      // Pre-fill the field with the first secret the handlers actually need, so
      // the common case is one paste and one click.
      setSecretName((current) => current || next.missingSecrets[0] || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailed'));
    }
  }, [projectId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSecret = async () => {
    if (!secretName.trim() || !secretValue || busy) return;
    setBusy(true);
    setError(null);
    try {
      await projectBackendApi.setSecret(projectId, secretName.trim().toUpperCase(), secretValue);
      setSecretValue('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const switchStrategy = async (strategy: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await projectBackendApi.setStrategy(projectId, strategy);
      await projectBackendApi.materialize(projectId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const togglePaused = async (paused: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await projectBackendApi.setStatus(projectId, paused ? 'paused' : 'active');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const removeHandler = async (name: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await projectBackendApi.deleteHandler(projectId, name);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <div style={{ ...card, fontSize: 14, color: 'var(--text-secondary)' }}>
        {error ?? t('loading')}
      </div>
    );
  }

  const target = view.backend.deployedUrl ?? view.backend.ingressUrl;
  const paused = view.backend.status !== 'active';
  const health = view.workerHealth;
  const unboundSecrets = health ? Object.entries(health.secrets).filter(([, bound]) => !bound).map(([n]) => n) : [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ ...card, display: 'grid', gap: 12 }}>
        <div style={label}>{t('title')}</div>

        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('addressLabel')}</span>
          <span style={code}>{target}</span>
          {view.backend.deployedUrl && (
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{t('deployedNote')}</span>
          )}
        </div>

        {/* The address a person actually types. Shown as its own row rather than
            replacing the ingress URL: the two are for different callers, and a
            provider console still needs the token address. */}
        {view.backend.siteUrl && (
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('siteAddressLabel')}</span>
            <span style={code}>{view.backend.siteUrl}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {t('siteAddressNote')}
            </span>
          </div>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('strategyLabel')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {view.strategies.map((s) => {
              const active = s.key === view.backend.strategy;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => void switchStrategy(s.key)}
                  disabled={busy || active}
                  title={s.summary}
                  style={{
                    ...button,
                    borderColor: active ? 'var(--accent, #2f6fed)' : 'var(--border-subtle)',
                    color: active ? 'var(--accent, #2f6fed)' : 'var(--text-primary)',
                    cursor: active ? 'default' : 'pointer',
                    opacity: busy && !active ? 0.6 : 1,
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* The kill switch. A public URL that can be created from the product but
            only stopped from the database is not a finished feature. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => void togglePaused(!paused)}
            disabled={busy}
            style={{
              ...button,
              borderColor: paused ? 'var(--warning, #9a6200)' : 'var(--border-subtle)',
              color: paused ? 'var(--warning, #9a6200)' : 'var(--text-primary)',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {paused ? t('resumeIngress') : t('pauseIngress')}
          </button>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, flex: '1 1 240px' }}>
            {paused ? t('pausedNote') : t('pauseHint')}
          </span>
        </div>
      </div>

      {/* Deployed-Worker readiness. "Deployed" and "will 403 every request" look
          identical from outside without this. */}
      {health && (
        <div
          style={{
            ...card,
            display: 'grid',
            gap: 8,
            borderColor: health.reachable && unboundSecrets.length === 0 ? 'var(--border-subtle)' : 'var(--warning, #9a6200)',
          }}
        >
          <div style={label}>{t('workerHealthLabel')}</div>
          {!health.reachable ? (
            <div style={{ fontSize: 13, color: 'var(--warning, #9a6200)', lineHeight: 1.5 }}>
              {t('workerUnreachable', { reason: health.reason ?? '' })}
            </div>
          ) : unboundSecrets.length > 0 ? (
            <div style={{ fontSize: 13, color: 'var(--warning, #9a6200)', lineHeight: 1.5 }}>
              {t('workerMissingSecrets', { names: unboundSecrets.join(', ') })}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--success, #167a4a)', lineHeight: 1.5 }}>
              {t('workerReady', { count: Object.keys(health.secrets).length })}
            </div>
          )}
        </div>
      )}

      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ ...label, marginBottom: 0 }}>{t('endpointsLabel')}</div>
          <button
            type="button"
            onClick={() => setEditing({ name: null, spec: null })}
            disabled={busy}
            style={{ ...button, padding: '4px 10px', fontSize: 13 }}
          >
            {t('addHandler')}
          </button>
        </div>

        {view.handlers.length === 0 && !editing && (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t('noHandlers')}</div>
        )}

        {view.handlers.map((h) => (
          <div key={h.name} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
            <span style={code}>{h.method} {h.siteUrl ?? h.url}</span>
            <span style={{ fontSize: 12.5, color: h.verify === 'none' ? 'var(--warning, #9a6200)' : 'var(--text-secondary)' }}>
              {h.verify === 'none' ? t('unverified') : h.verify}
            </span>
            <button
              type="button"
              onClick={() => setEditing({ name: h.name, spec: h.spec })}
              disabled={busy}
              style={{ ...button, padding: '2px 10px', fontSize: 13 }}
            >
              {t('edit')}
            </button>
            <button
              type="button"
              onClick={() => void removeHandler(h.name)}
              disabled={busy}
              style={{ ...button, padding: '2px 10px', fontSize: 13 }}
            >
              {t('remove')}
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <HandlerEditor
          projectId={projectId}
          name={editing.name}
          spec={editing.spec}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {view.handlerErrors.length > 0 && (
        <div style={{ ...card, display: 'grid', gap: 8, borderColor: 'var(--danger, #b3261e)' }}>
          <div style={label}>{t('brokenLabel')}</div>
          {view.handlerErrors.map((e) => (
            <div key={e.path} style={{ fontSize: 13, color: 'var(--danger, #b3261e)' }}>
              {e.path}: {e.reason}
            </div>
          ))}
        </div>
      )}

      <div style={{ ...card, display: 'grid', gap: 12 }}>
        <div style={label}>{t('secretsLabel')}</div>

        {view.missingSecrets.length > 0 && (
          <div style={{ fontSize: 13, color: 'var(--warning, #9a6200)', lineHeight: 1.5 }}>
            {t('missingSecrets', { names: view.missingSecrets.join(', ') })}
          </div>
        )}

        {view.secrets.map((s) => (
          <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={code}>{s.name}</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {s.hint ? `••••${s.hint}` : t('stored')}
            </span>
            <button
              type="button"
              onClick={async () => {
                setBusy(true);
                try {
                  await projectBackendApi.deleteSecret(projectId, s.name);
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy}
              style={{ ...button, padding: '4px 10px', fontSize: 13 }}
            >
              {t('remove')}
            </button>
          </div>
        ))}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            value={secretName}
            onChange={(e) => setSecretName(e.target.value)}
            placeholder={t('secretNamePlaceholder')}
            aria-label={t('secretNamePlaceholder')}
            style={input}
          />
          <input
            type="password"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            placeholder={t('secretValuePlaceholder')}
            aria-label={t('secretValuePlaceholder')}
            style={input}
          />
          <button
            type="button"
            onClick={() => void saveSecret()}
            disabled={busy || !secretName.trim() || !secretValue}
            style={{ ...button, opacity: busy || !secretName.trim() || !secretValue ? 0.6 : 1 }}
          >
            {t('storeSecret')}
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {t('secretsNote')}
        </div>
      </div>

      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div style={label}>{t('deliveriesLabel')}</div>
        {requests.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t('noDeliveries')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 440 }}>
              <thead>
                <tr>
                  {[t('colWhen'), t('colRoute'), t('colStatus'), t('colVerdict')].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px',
                        borderBottom: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {r.createdAt ? new Date(r.createdAt).toLocaleTimeString() : '—'}
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                      {r.method} {r.route}
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                      {r.statusCode}
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: VERDICT_COLOR[r.verdict] ?? 'var(--text-primary)' }}>
                      {t(`verdict.${r.verdict}`)}
                      {r.error && (
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{r.error}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" onClick={() => void load()} disabled={busy} style={{ ...button, justifySelf: 'start' }}>
          {t('refresh')}
        </button>
      </div>

      {error && (
        <div style={{ ...card, borderColor: 'var(--danger, #b3261e)', color: 'var(--danger, #b3261e)', fontSize: 14 }}>
          {error}
        </div>
      )}
    </div>
  );
}
