'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import {
  connectorsApi,
  type ConnectorManifest,
  type ConnectorSummary,
} from '@/lib/connectorsApi';

/**
 * Connector builder — how a company creates a connector without writing code.
 *
 * Two routes in, on purpose:
 *   • IMPORT — paste an OpenAPI/Swagger URL (or the document itself) and get a
 *     draft manifest with every operation mapped. This is the path that actually
 *     gets used: hand-entering forty endpoints is a day of work nobody does.
 *   • MANIFEST — edit the JSON directly, for an API with no spec and for tuning
 *     what the import produced.
 *
 * A new connector is saved as a DRAFT. Drafts are callable from here (that is how
 * you iterate) but are never advertised to agents, so a half-finished connector
 * cannot appear in a model's tool list. Publishing is the explicit second step.
 */

const btnPrimary: React.CSSProperties = {
  padding: '9px 15px', fontSize: 13, fontWeight: 650, background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const btnSubtle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 12.5, fontWeight: 600, background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)', marginBottom: 5,
};
const codeArea: React.CSSProperties = {
  ...inputStyle,
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontSize: 12,
  lineHeight: 1.55,
  minHeight: 320,
  resize: 'vertical',
};

/** Starting point for a hand-written connector — a complete, valid manifest. */
const STARTER: ConnectorManifest = {
  key: 'my-api',
  name: 'My API',
  description: 'What this connector lets an agent do.',
  category: 'other',
  icon: '🔌',
  baseUrl: 'https://api.example.com/v1',
  auth: {
    kind: 'bearer',
    fields: [{ key: 'token', label: 'API token', secret: true, required: true }],
  },
  actions: [
    {
      key: 'list_items',
      label: 'List items',
      description: 'List items, newest first.',
      method: 'GET',
      path: '/items',
      mutates: false,
      params: { limit: { type: 'number', in: 'query', description: 'Max results' } },
    },
  ],
};

type BuilderTab = 'import' | 'manifest';

export function ConnectorBuilder({ open, editKey, onClose, onSaved }: {
  open: boolean;
  /** Connector key being edited, or null to create a new one. */
  editKey: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('connectors');
  const tc = useTranslations('common');
  const confirm = useConfirm();

  const [tab, setTab] = useState<BuilderTab>('import');
  const [json, setJson] = useState(() => JSON.stringify(STARTER, null, 2));
  const [rowId, setRowId] = useState<string | null>(null);
  const [status, setStatus] = useState<'published' | 'draft'>('draft');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Import form
  const [importKey, setImportKey] = useState('');
  const [specUrl, setSpecUrl] = useState('');
  const [specText, setSpecText] = useState('');

  const reset = useCallback(() => {
    setTab('import');
    setJson(JSON.stringify(STARTER, null, 2));
    setRowId(null); setStatus('draft');
    setErrors([]); setNotice(null); setWarnings([]);
    setImportKey(''); setSpecUrl(''); setSpecText('');
  }, []);

  // Editing an existing connector skips straight to the manifest — the import tab
  // would silently discard the hand-tuning that is the whole reason to re-open it.
  useEffect(() => {
    if (!open) return;
    if (!editKey) { reset(); return; }
    setErrors([]); setNotice(null); setWarnings([]);
    connectorsApi.get(editKey)
      .then((d) => {
        setJson(JSON.stringify(d.manifest, null, 2));
        setRowId(d.id);
        setStatus(d.status);
        setTab('manifest');
      })
      .catch((e) => setErrors([e instanceof Error ? e.message : 'Failed to load connector']));
  }, [open, editKey, reset]);

  /** Local JSON validity — the server is authoritative, this just avoids a round-trip. */
  const parsed = useMemo<{ ok: true; value: ConnectorManifest } | { ok: false; message: string }>(() => {
    try {
      return { ok: true, value: JSON.parse(json) as ConnectorManifest };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Invalid JSON' };
    }
  }, [json]);

  const runImport = async () => {
    setBusy(true); setErrors([]); setNotice(null); setWarnings([]);
    try {
      let spec: unknown;
      if (specText.trim()) {
        try {
          spec = JSON.parse(specText);
        } catch {
          setErrors([t('builder.specNotJson')]);
          return;
        }
      }
      const result = await connectorsApi.importOpenApi({
        key: importKey.trim().toLowerCase(),
        ...(spec ? { spec } : { specUrl: specUrl.trim() }),
      });
      setJson(JSON.stringify(result.manifest, null, 2));
      setWarnings(result.warnings);
      setNotice(t('builder.imported', { count: result.manifest.actions.length, total: result.totalOperations }));
      setTab('manifest');
    } catch (e) {
      const err = e as { message?: string; details?: string[] };
      setErrors(err.details?.length ? err.details : [err.message ?? t('builder.importFailed')]);
    } finally {
      setBusy(false);
    }
  };

  const save = async (publish: boolean) => {
    if (!parsed.ok) { setErrors([parsed.message]); return; }
    setBusy(true); setErrors([]); setNotice(null);
    try {
      if (rowId) {
        await connectorsApi.update(rowId, { manifest: parsed.value, status: publish ? 'published' : status });
      } else {
        const created = await connectorsApi.create(parsed.value, publish);
        setRowId(created.id);
      }
      if (publish) setStatus('published');
      onSaved();
    } catch (e) {
      const err = e as { message?: string; details?: string[] };
      setErrors(err.details?.length ? err.details : [err.message ?? t('builder.saveFailed')]);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!rowId) return;
    if (!(await confirm({ message: t('builder.confirmDelete'), destructive: true }))) return;
    setBusy(true);
    try {
      await connectorsApi.remove(rowId);
      onSaved();
    } catch (e) {
      setErrors([e instanceof Error ? e.message : t('builder.deleteFailed')]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlideOutPanel
      open={open}
      onClose={onClose}
      title={editKey ? t('builder.editTitle', { key: editKey }) : t('builder.newTitle')}
      tabs={editKey ? undefined : [
        { id: 'import', label: t('builder.tabImport') },
        { id: 'manifest', label: t('builder.tabManifest') },
      ]}
      activeTabId={tab}
      onTabChange={(id) => setTab(id as BuilderTab)}
    >
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {errors.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--danger)', lineHeight: 1.6 }}>
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        {notice && <div style={{ fontSize: 12.5, color: 'var(--success)' }}>{notice}</div>}
        {warnings.length > 0 && (
          <details style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 650 }}>{t('builder.warnings', { count: warnings.length })}</summary>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </details>
        )}

        {tab === 'import' && !editKey && (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
              {t('builder.importBlurb')}
            </p>
            <div>
              <label style={labelStyle} htmlFor="imp-key">{t('builder.keyLabel')}</label>
              <input
                id="imp-key" style={inputStyle} value={importKey}
                onChange={(e) => setImportKey(e.target.value)}
                placeholder="acme-erp"
              />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('builder.keyHelp')}</p>
            </div>
            <div>
              <label style={labelStyle} htmlFor="imp-url">{t('builder.specUrlLabel')}</label>
              <input
                id="imp-url" style={inputStyle} value={specUrl}
                onChange={(e) => setSpecUrl(e.target.value)}
                placeholder="https://api.example.com/openapi.json"
              />
            </div>
            <div>
              <label style={labelStyle} htmlFor="imp-text">{t('builder.specPasteLabel')}</label>
              <textarea
                id="imp-text"
                style={{ ...codeArea, minHeight: 160 }}
                value={specText}
                onChange={(e) => setSpecText(e.target.value)}
                placeholder={t('builder.specPastePlaceholder')}
              />
            </div>
            <div>
              <button
                type="button" style={btnPrimary} disabled={busy || !importKey.trim() || (!specUrl.trim() && !specText.trim())}
                onClick={runImport}
              >
                {busy ? t('builder.importing') : t('builder.import')}
              </button>
            </div>
          </>
        )}

        {tab === 'manifest' && (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
              {t('builder.manifestBlurb')}
            </p>
            <div>
              <label style={labelStyle} htmlFor="man-json">{t('builder.manifestLabel')}</label>
              <textarea
                id="man-json"
                style={{ ...codeArea, borderColor: parsed.ok ? 'var(--border-subtle)' : 'var(--danger)' }}
                value={json}
                spellCheck={false}
                onChange={(e) => setJson(e.target.value)}
              />
              {!parsed.ok && (
                <p style={{ fontSize: 11, color: 'var(--danger)', margin: '4px 0 0' }}>{parsed.message}</p>
              )}
              {parsed.ok && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  {t('builder.summary', {
                    key: parsed.value.key ?? '—',
                    count: Array.isArray(parsed.value.actions) ? parsed.value.actions.length : 0,
                  })}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" style={btnSubtle} disabled={busy || !parsed.ok} onClick={() => save(false)}>
                {t('builder.saveDraft')}
              </button>
              <button type="button" style={btnPrimary} disabled={busy || !parsed.ok} onClick={() => save(true)}>
                {t('builder.publish')}
              </button>
              {rowId && (
                <button type="button" style={{ ...btnSubtle, color: 'var(--danger)' }} disabled={busy} onClick={remove}>
                  {tc('delete')}
                </button>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {status === 'published' ? t('builder.statusPublished') : t('builder.statusDraft')}
              </span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
              {t('builder.publishHelp')}
            </p>
          </>
        )}
      </div>
    </SlideOutPanel>
  );
}

/** Re-exported for the gallery's type imports without a second import site. */
export type { ConnectorSummary };
