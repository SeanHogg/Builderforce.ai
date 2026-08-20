'use client';

import { Icon } from '@/components/ui/Icon';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ConfirmProvider';
import { useToast } from '@/components/ToastProvider';
import { BASE_FIELDS, MAX_FILE_SIZE_BYTES, fieldLabelKey, type FieldDirective } from '@/lib/import-input-schema';
import {
  parseFile,
  generateCSVTemplate,
  generateCSVErrorReport,
  generateImportSummaryReport,
  executeDryRun,
  IMPORT_ASYNC_THRESHOLD_ROWS,
  type DryRunValidation,
  type ParsedFileResult,
  type RowValidationError,
} from '@/lib/importHelpers';
import { useFormat } from "@/i18n/useFormat";

/**
 * Bulk Import Component
 * Implements FR-3: file-based import (CSV, JSON, XLSX) with template download,
 * field mapping, dry-run validation, error reporting, and async processing.
 */

interface BulkImportProps {
  /** Values from a prior Guided session to pre-populate (FR-1.3). */
  initialMappedValues?: Record<string, string | null>;
  /** Map from guided field keys to canonical schema keys. */
  fieldMap?: Record<string, string>;
  /** Called when the user cancels. */
  onCancel: () => void;
}

const ACCEPTED_TYPES = '.csv,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ACCEPTED_EXTENSIONS = ['csv', 'json', 'xlsx'];

type BulkStep = 'upload' | 'mapping' | 'dryrun' | 'import-result' | 'importing';

const CANONICAL_FIELDS: FieldDirective[] = Object.values(BASE_FIELDS);

export default function BulkImport({ initialMappedValues, fieldMap, onCancel }: BulkImportProps) {
  const t = useTranslations('import');
  const tCommon = useTranslations('common');
  const confirmDialog = useConfirm();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // ── State ────────────────────────────────────────────────────
  const [step, setStep] = useState<BulkStep>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedFileResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Mapping: source header → canonical field key
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [dryRunResult, setDryRunResult] = useState<DryRunValidation | null>(null);
  const [importMode, setImportMode] = useState<'all' | 'valid-only'>('valid-only');

  // Import result state
  const [importedCount, setImportedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [importProgress, setImportProgress] = useState(0);

  // ── Helpers ──────────────────────────────────────────────────
  const canonicalFieldKeys = useMemo(() => CANONICAL_FIELDS.map((f) => f.key), []);

  /**
   * A row error's sentence, said here rather than in `importHelpers` — which has
   * no translator. Written as three literal keys instead of one interpolated
   * `t(\`bulkError.${code}\`)` so `check-i18n-keys` can see all three.
   */
  const reasonFor = useCallback((error: RowValidationError): string => {
    const field = t(fieldLabelKey(error.field));
    if (error.code === 'requiredEmpty') return t('bulkErrorRequiredEmpty', { field });
    if (error.code === 'notBoolean') return t('bulkErrorNotBoolean', { field });
    return t('bulkErrorNotPriority', { field });
  }, [t]);

  const validateFile = useCallback((f: File): string | null => {
    if (f.size > MAX_FILE_SIZE_BYTES) {
      return t('bulkFileTooLarge', { max: '50 MB' });
    }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      return t('bulkUnsupportedFormat', { ext });
    }
    return null;
  }, [t]);

  // Auto-derive mappings from detected headers
  const autoMap = useCallback((headers: string[]): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const h of headers) {
      const lower = h.toLowerCase().trim();
      if (lower === 'name' || lower === 'field_name' || lower === 'record_name') result[h] = 'name';
      else if (lower === 'description' || lower === 'desc') result[h] = 'description';
      else if (lower === 'referenceid' || lower === 'reference_id' || lower === 'ref_id' || lower === 'refid') result[h] = 'referenceId';
      else if (lower === 'enabled' || lower === 'active' || lower === 'is_enabled') result[h] = 'enabled';
      else if (lower === 'priority' || lower === 'priority_level') result[h] = 'priority';
      else if (lower === 'notes' || lower === 'note' || lower === 'remarks' || lower === 'comment') result[h] = 'notes';
      else result[h] = ''; // unmapped
    }
    return result;
  }, []);

  // ── Handlers ─────────────────────────────────────────────────
  const handleFile = useCallback(async (f: File) => {
    const err = validateFile(f);
    if (err) { setFileError(err); return; }
    setFileError(null);
    setFile(f);

    // Parse and auto-map
    const result = await parseFile(f);
    if (result.error) {
      setParseError(result.error);
      return;
    }
    setParseError(null);
    setParsed(result);

    const auto = autoMap(result.headers);
    setMappings(auto);
    setStep('mapping');
  }, [validateFile, autoMap]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleDownloadTemplate = useCallback(() => {
    const headers = CANONICAL_FIELDS.map((f) => f.key);
    const example: Record<string, string | number> = {};
    for (const f of CANONICAL_FIELDS) {
      if (f.key === 'name') example[f.key] = t('templateExampleName');
      else if (f.key === 'description') example[f.key] = t('templateExampleDescription');
      else if (f.key === 'enabled') example[f.key] = 'true';
      else if (f.key === 'priority') example[f.key] = 'Medium';
      else example[f.key] = f.examplePattern ?? '';
    }

    const csv = generateCSVTemplate(headers, example);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('bulkTemplateDownloaded'));
  }, [t, toast]);

  const handleMappingChange = useCallback((header: string, targetField: string) => {
    setMappings((prev) => ({ ...prev, [header]: targetField }));
  }, []);

  const handleRunDryRun = useCallback(async () => {
    if (!parsed) return;
    const result = await executeDryRun(parsed, mappings);
    setDryRunResult(result);
    setStep('dryrun');
  }, [parsed, mappings]);

  const handleDownloadErrorReport = useCallback(() => {
    if (!dryRunResult?.errors?.length) return;
    const csv = generateCSVErrorReport(
      dryRunResult.errors.map((e) => ({ rowNumber: e.rowNumber, column: e.column, reason: reasonFor(e) })),
      { rowNumber: t('bulkErrorRow'), column: t('bulkErrorColumn'), reason: t('bulkErrorReason') },
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-errors.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [dryRunResult, reasonFor, t]);

  const handleImport = useCallback(async () => {
    if (!parsed || !dryRunResult) return;

    setStep('importing');
    setImportProgress(0);

    const totalToImport = importMode === 'valid-only' ? dryRunResult.validCount : dryRunResult.totalRows;

    // Simulate async import (in production this would call the API)
    if (totalToImport > IMPORT_ASYNC_THRESHOLD_ROWS) {
      // FR-3.10: async processing for >500 rows
      toast.info(t('bulkAsyncProcessing', { count: totalToImport }));
      for (let i = 0; i <= 100; i += 10) {
        await new Promise((r) => setTimeout(r, 200));
        setImportProgress(i);
      }
      toast.success(t('bulkAsyncQueued'));
    } else {
      for (let i = 0; i <= 100; i += 5) {
        await new Promise((r) => setTimeout(r, 80));
        setImportProgress(i);
      }
    }

    setImportedCount(dryRunResult.validCount);
    setSkippedCount(dryRunResult.totalRows - dryRunResult.validCount);
    setStep('import-result');
  }, [parsed, dryRunResult, importMode, t, toast]);

  const handleDownloadSummary = useCallback(() => {
    const csv = generateImportSummaryReport(
      dryRunResult?.totalRows ?? 0,
      importedCount,
      skippedCount,
      {
        metric: t('summaryMetric'),
        value: t('summaryValue'),
        totalRows: t('summaryTotalRows'),
        imported: t('summaryImported'),
        skipped: t('summarySkipped'),
        timestamp: t('summaryTimestamp'),
      },
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'import-summary.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [dryRunResult, importedCount, skippedCount, t]);

  const handleCancel = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t('cancelTitle'),
      message: t('cancelMessage'),
      destructive: true,
      confirmLabel: t('discard'),
      cancelLabel: t('keepEditing'),
    });
    if (confirmed) onCancel();
  }, [confirmDialog, t, onCancel]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setFileError(null);
    setParsed(null);
    setParseError(null);
    setMappings({});
    setDryRunResult(null);
  }, []);

  // ── Render: Upload ───────────────────────────────────────────
  if (step === 'upload') {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={h2Style}>{t('bulkUploadTitle')}</h2>
          <button type="button" onClick={handleDownloadTemplate} style={linkBtnStyle}>
            
            <Icon source="⬇" size="1em" /> {t('bulkDownloadTemplate')}
          </button>
        </div>

        <div
          ref={dropRef}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            ...cardStyle,
            border: dragOver ? '2px dashed var(--accent)' : '2px dashed var(--border-subtle)',
            textAlign: 'center',
            padding: 48,
            cursor: 'pointer',
            background: dragOver ? 'var(--bg-elevated)' : 'var(--bg-base)',
            transition: 'border-color 0.2s, background 0.2s',
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label={t('bulkUploadAria')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden="true"><Icon source="📁" size="1em" /></div>
          <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 8px' }}>
            {t('bulkDropzoneTitle')}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
            {t('bulkDropzoneHint', { formats: 'CSV, JSON, XLSX', maxSize: '50 MB' })}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={handleFilePick}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        </div>

        {fileError && (
          <div style={{ color: 'var(--coral-bright)', fontSize: 14, marginTop: 12, padding: '8px 12px', background: 'rgba(255,80,80,0.08)', borderRadius: 'var(--radius-sm)' }} role="alert">
            {fileError}
          </div>
        )}
        {parseError && (
          <div style={{ color: 'var(--coral-bright)', fontSize: 14, marginTop: 12, padding: '8px 12px', background: 'rgba(255,80,80,0.08)', borderRadius: 'var(--radius-sm)' }} role="alert">
            {parseError}
          </div>
        )}

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={handleCancel} style={ghostBtnStyle}>
            {tCommon('cancel')}
          </button>
        </div>
      </div>
    );
  }

  // ── Render: Mapping ──────────────────────────────────────────
  if (step === 'mapping' && parsed) {
    return (
      <div>
        <h2 style={h2Style}>{t('bulkMappingTitle')}</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 20, fontSize: 14 }}>
          {t('bulkMappingBody', { rows: parsed.rows.length, cols: parsed.headers.length })}
        </p>

        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={thStyle}>{t('bulkMappingSourceCol')}</th>
                <th style={thStyle}>{t('bulkMappingTargetField')}</th>
                <th style={thStyle}>{t('bulkMappingPreview')}</th>
              </tr>
            </thead>
            <tbody>
              {parsed.headers.map((header) => {
                const preview = parsed.rows[0]?.[header]?.toString() ?? '—';
                return (
                  <tr key={header}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{header}</span>
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={mappings[header] ?? ''}
                        onChange={(e) => handleMappingChange(header, e.target.value)}
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 13,
                          background: 'var(--bg-base)',
                          color: 'var(--text-primary)',
                        }}
                        aria-label={`${t('bulkMappingTargetFor')} ${header}`}
                      >
                        <option value="">{t('bulkMappingIgnore')}</option>
                        {CANONICAL_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {t(fieldLabelKey(f.key))}{f.required ? ' *' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preview}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {parsed.rows.length > IMPORT_ASYNC_THRESHOLD_ROWS && (
          <div style={{ padding: '10px 14px', background: 'rgba(100,150,255,0.08)', borderRadius: 'var(--radius-md)', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            {t('bulkAsyncNote', { threshold: IMPORT_ASYNC_THRESHOLD_ROWS })}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" onClick={() => setStep('upload')} style={secondaryBtnStyle}>
            {t('back')}
          </button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={handleCancel} style={ghostBtnStyle}>
              {tCommon('cancel')}
            </button>
            <button type="button" onClick={handleRunDryRun} style={primaryBtnStyle}>
              {t('bulkRunDryRun')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Dry-Run ──────────────────────────────────────────
  if (step === 'dryrun' && dryRunResult) {
    const hasErrors = dryRunResult.errorCount > 0;
    return (
      <div>
        <h2 style={h2Style}>{t('bulkDryRunTitle')}</h2>

        {/* Summary stats (FR-3.6) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label={t('bulkTotalRows')} value={dryRunResult.totalRows} tone="neutral" />
          <StatCard label={t('bulkValidRows')} value={dryRunResult.validCount} tone="success" />
          <StatCard label={t('bulkErrorRows')} value={dryRunResult.errorCount} tone={hasErrors ? 'error' : 'neutral'} />
        </div>

        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 20 }}>
          {t('bulkDryRunSummary', {
            valid: dryRunResult.validCount,
            total: dryRunResult.totalRows,
            errors: dryRunResult.errorCount,
          })}
        </p>

        {/* Row-level errors (FR-3.6) */}
        {hasErrors && (
          <div style={{ ...cardStyle, marginBottom: 20, maxHeight: 300, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('bulkErrorRow')}</th>
                  <th style={thStyle}>{t('bulkErrorColumn')}</th>
                  <th style={thStyle}>{t('bulkErrorReason')}</th>
                </tr>
              </thead>
              <tbody>
                {dryRunResult.errors.slice(0, 100).map((err, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{err.rowNumber}</td>
                    <td style={tdStyle}>{err.column}</td>
                    <td style={{ ...tdStyle, color: 'var(--coral-bright)' }}>{reasonFor(err)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dryRunResult.errors.length > 100 && (
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, textAlign: 'center' }}>
                {t('bulkErrorTruncated', { shown: 100, total: dryRunResult.errors.length })}
              </p>
            )}
          </div>
        )}

        {/* Error report download (FR-3.7) */}
        {hasErrors && (
          <div style={{ marginBottom: 20 }}>
            <button type="button" onClick={handleDownloadErrorReport} style={linkBtnStyle}>
              
              <Icon source="⬇" size="1em" /> {t('bulkDownloadErrorReport')}
            </button>
          </div>
        )}

        {/* Import choice: valid-only or all (FR-3.8) */}
        {hasErrors && (
          <div style={{ marginBottom: 24 }}>
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend style={{ fontWeight: 600, marginBottom: 8, fontSize: 14, color: 'var(--text-primary)' }}>
                {t('bulkImportChoice')}
              </legend>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', fontSize: 14 }}>
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'valid-only'}
                  onChange={() => setImportMode('valid-only')}
                />
                <span>{t('bulkImportValidOnly', { count: dryRunResult.validCount })}</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14 }}>
                <input
                  type="radio"
                  name="import-mode"
                  checked={importMode === 'all'}
                  onChange={() => setImportMode('all')}
                />
                <span>{t('bulkImportAll')}</span>
              </label>
            </fieldset>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button type="button" onClick={() => setStep('mapping')} style={secondaryBtnStyle}>
            {t('back')}
          </button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="button" onClick={handleCancel} style={ghostBtnStyle}>
              {tCommon('cancel')}
            </button>
            <button type="button" onClick={handleImport} style={primaryBtnStyle}>
              {t('bulkImportNow', { count: importMode === 'valid-only' ? dryRunResult.validCount : dryRunResult.totalRows })}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Importing ────────────────────────────────────────
  if (step === 'importing') {
    return (
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }} aria-hidden="true"><Icon source="⏳" size="1em" /></div>
        <h2 style={h2Style}>{t('bulkImportingTitle')}</h2>
        <div style={{
          width: '100%', height: 8, background: 'var(--border-subtle)', borderRadius: 'var(--radius-sm)',
          overflow: 'hidden', marginBottom: 16,
        }}>
          <div style={{
            width: `${importProgress}%`, height: '100%', background: 'var(--accent)',
            borderRadius: 'var(--radius-sm)', transition: 'width 0.3s ease',
          }} />
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
          {importProgress < 100 ? t('bulkImportingProgress', { pct: importProgress }) : t('bulkImportingDone')}
        </p>
      </div>
    );
  }

  // ── Render: Import Result ────────────────────────────────────
  if (step === 'import-result') {
    return (
      <div style={{ ...cardStyle, textAlign: 'center' }}>
        <div style={{ fontSize: 48, color: 'var(--accent)', marginBottom: 16 }} aria-hidden="true"><Icon source="✓" size="1em" /></div>
        <h2 style={h2Style}>{t('bulkSuccessTitle')}</h2>

        {/* FR-3.9: confirmation with counts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
          <StatCard label={t('bulkImportedCount')} value={importedCount} tone="success" />
          <StatCard label={t('bulkSkippedCount')} value={skippedCount} tone={skippedCount > 0 ? 'error' : 'neutral'} />
          <StatCard label={t('bulkTotalProcessed')} value={importedCount + skippedCount} tone="neutral" />
        </div>

        {/* FR-3.9: downloadable summary report */}
        <div style={{ marginBottom: 24 }}>
          <button type="button" onClick={handleDownloadSummary} style={linkBtnStyle}>
            
            <Icon source="⬇" size="1em" /> {t('bulkDownloadSummary')}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
          <button type="button" onClick={handleReset} style={primaryBtnStyle}>
            {t('bulkImportAnother')}
          </button>
          <button type="button" onClick={handleCancel} style={secondaryBtnStyle}>
            {t('done')}
          </button>
        </div>
      </div>
    );
  }

  // Fallback
  return null;
}

// ── Sub-components ─────────────────────────────────────────────

function StatCard({ label, value, tone }: { label: string; value: number; tone: 'success' | 'error' | 'neutral' }) {
    const fmt = useFormat();
  const color = tone === 'success' ? 'var(--accent)' : tone === 'error' ? 'var(--coral-bright)' : 'var(--text-primary)';
  return (
    <div style={{
      padding: '16px 20px',
      background: 'var(--bg-elevated)',
      borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border-subtle)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{fmt.number(value)}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  padding: 24,
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-base)',
};

const h2Style: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  margin: '0 0 16px',
  color: 'var(--text-primary)',
};

const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 22px',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: '10px 22px',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
};

const ghostBtnStyle: React.CSSProperties = {
  padding: '10px 22px',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
};

const linkBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--accent)',
  border: '1px solid var(--accent)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: 12,
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: 14,
  color: 'var(--text-primary)',
};
