'use client';

/**
 * ModelExportPanel — export a published Evermind model to a portable artifact.
 *
 * Picks one of the tenant's published models and a format (Hugging Face repo,
 * ONNX, safetensors, or GGUF), then streams the export from the server and
 * downloads it. The heavy model stays server-side; the engine's export subsystem
 * produces the files (no external credential — pushing to a hub is a separate
 * step). Self-gating per the DRY rule: the panel owns its own model/format/
 * loading/empty/error states; the host only mounts it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  listEvermindModels,
  exportPublishedModel,
  EVERMIND_EXPORT_FORMATS,
  type PublishedEvermindModel,
  type EvermindExportFormat,
} from '@/lib/studioModelsApi';

export function ModelExportPanel() {
  const t = useTranslations('modelExport');
  const [models, setModels] = useState<PublishedEvermindModel[] | null>(null);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [format, setFormat] = useState<EvermindExportFormat>('huggingface');
  const [fp16, setFp16] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listEvermindModels()
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        if (list.length > 0) setSelectedSlug((s) => s || list[0].slug);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fp16Supported = format === 'safetensors' || format === 'gguf';

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const filename = await exportPublishedModel(selectedSlug, format, fp16Supported && fp16);
      setDone(filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error'));
    } finally {
      setBusy(false);
    }
  }, [selectedSlug, format, fp16, fp16Supported, t]);

  const noModels = models !== null && models.length === 0;
  const disabled = busy || !selectedSlug || noModels;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5, margin: 0 }}>
        {t('subtitle')}
      </p>

      {/* Model picker */}
      <div>
        <label
          htmlFor="evermind-export-model"
          style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}
        >
          {t('modelLabel')}
        </label>
        {noModels ? (
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{t('noModels')}</div>
        ) : (
          <select
            id="evermind-export-model"
            value={selectedSlug}
            onChange={(e) => setSelectedSlug(e.target.value)}
            disabled={models === null}
            style={{
              width: '100%', background: 'var(--bg-deep)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 10px', fontSize: '0.8rem',
            }}
          >
            {models === null && <option>{t('loading')}</option>}
            {models?.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Format picker */}
      {!noModels && (
        <div>
          <label
            htmlFor="evermind-export-format"
            style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 4 }}
          >
            {t('formatLabel')}
          </label>
          <select
            id="evermind-export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as EvermindExportFormat)}
            style={{
              width: '100%', background: 'var(--bg-deep)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 10px', fontSize: '0.8rem',
            }}
          >
            {EVERMIND_EXPORT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {t(`format.${f.key}.label`)} ({f.ext})
              </option>
            ))}
          </select>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {t(`format.${format}.description`)}
          </div>
        </div>
      )}

      {/* fp16 toggle (only where the format supports it) */}
      {!noModels && fp16Supported && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={fp16} onChange={(e) => setFp16(e.target.checked)} />
          {t('fp16Label')}
        </label>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={disabled}
          style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem',
            background: busy ? 'var(--bg-elevated)' : 'var(--coral-bright, #4d9eff)',
            color: busy ? 'var(--text-muted)' : '#fff',
            border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 16px',
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
          }}
        >
          {busy ? `⏳ ${t('exporting')}` : `⬇ ${t('export')}`}
        </button>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('pushNote')}</span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            background: 'var(--warning-bg, rgba(239,68,68,0.12))', border: '1px solid #ef4444', color: '#fca5a5',
            borderRadius: 8, padding: '8px 12px', fontSize: '0.78rem',
          }}
        >
          ⚠ {error}
        </div>
      )}

      {done && (
        <div
          role="status"
          style={{
            background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e', color: 'var(--text-primary)',
            borderRadius: 8, padding: '8px 12px', fontSize: '0.78rem',
          }}
        >
          ✅ {t('done', { filename: done })}
        </div>
      )}
    </div>
  );
}
