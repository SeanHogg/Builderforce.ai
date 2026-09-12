'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon, Surface } from '@/components/ui';
import { useToast } from '@/components/ToastProvider';
import { formatBytes } from '@/lib/formatBytes';
import { downloadText } from '@/lib/download';
import { MAX_FILE_SIZE_BYTES, fieldLabelKey, kindLabelKey, type RecordKindInfo } from '@/lib/import-input-schema';
import type { ImportResult } from '@/lib/importApi';
import {
  ACCEPTED_EXTENSIONS,
  EMPTY_IMPORT_RESULT,
  autoMapHeaders,
  detectFileType,
  executeDryRun,
  generateCSVErrorReport,
  generateCSVTemplate,
  generateImportSummaryReport,
  mapRows,
  parseFile,
  unmappedRequiredFields,
  type DryRunValidation,
  type ParsedFileResult,
  type RowValidationError,
} from '@/lib/importHelpers';
import { useBulkImportSubmit } from '@/lib/useBulkImportSubmit';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { BulkDropzone } from './BulkDropzone';
import { BulkMappingTable } from './BulkMappingTable';
import { BulkDryRunReport } from './BulkDryRunReport';
import { ImportProgressBar } from './ImportProgressBar';
import { ImportResultSummary } from './ImportResultSummary';
import { cellErrorMessage } from './cellErrorMessage';
import { bodyText, buttonCluster, buttonRow, errorBanner, h2Style } from './importStyles';

/**
 * Bulk import: a file → its headers mapped onto the kind's columns → a client
 * dry run AND a server dry run → the valid rows posted in batches with real
 * progress → the server's aggregate result. The loop itself lives in
 * `useBulkImportSubmit`; this component only sequences the steps.
 */
interface BulkImportProps {
  kind: RecordKindInfo;
  onDirtyChange?: (dirty: boolean) => void;
  onCancel: () => void;
}

type BulkStep = 'upload' | 'mapping' | 'dryrun' | 'importing' | 'import-result';

const FORMATS_LABEL = ACCEPTED_EXTENSIONS.map((ext) => ext.toUpperCase()).join(', ');

export default function BulkImport({ kind, onDirtyChange, onCancel }: BulkImportProps) {
  const t = useTranslations('import');
  const tCommon = useTranslations('common');
  const errorMessage = useErrorMessage();
  const toast = useToast();
  const bulk = useBulkImportSubmit(kind.kind);

  const [step, setStep] = useState<BulkStep>('upload');
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedFileResult | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<DryRunValidation | null>(null);
  const [serverCheck, setServerCheck] = useState<ImportResult | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);

  const kindLabel = t(kindLabelKey(kind.kind));
  const labelOf = useCallback((key: string) => t(fieldLabelKey(key)), [t]);
  const reasonFor = useCallback((error: RowValidationError): string => cellErrorMessage(t, error.code, labelOf(error.field)), [t, labelOf]);

  /** The file rows the client check passed — what gets posted. */
  const validRows = useMemo(() => {
    if (!parsed || !dryRun) return [];
    return dryRun.validRowNumbers.flatMap((n) => { const row = parsed.rows[n - 1]; return row ? [row] : []; });
  }, [parsed, dryRun]);

  // ── Handlers ─────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(t('bulkFileTooLarge', { max: formatBytes(MAX_FILE_SIZE_BYTES) }));
      return;
    }
    if (!detectFileType(file.name)) {
      setFileError(t('bulkUnsupportedFile', { ext: file.name.split('.').pop()?.toLowerCase() ?? '' }));
      return;
    }
    const result = await parseFile(file);
    if (result.parseFailure) { setFileError(errorMessage(result.parseFailure.cause) ?? tCommon('actionFailed')); return; }
    if (result.error) { setFileError(result.error); return; }
    setFileError(null);
    setParsed(result);
    setMappings(autoMapHeaders(result.headers, kind.fields));
    setMappingError(null);
    onDirtyChange?.(true);
    setStep('mapping');
  }, [t, tCommon, errorMessage, kind.fields, onDirtyChange]);

  const handleDownloadTemplate = useCallback(() => {
    downloadText(generateCSVTemplate(kind.fields), `import-template-${kind.kind}.csv`, 'text/csv;charset=utf-8;');
    toast.success(t('bulkTemplateDownloaded'));
  }, [kind, t, toast]);

  const handleMappingChange = useCallback((header: string, target: string) => {
    setMappings((prev) => ({ ...prev, [header]: target }));
    setMappingError(null);
  }, []);

  const handleRunDryRun = useCallback(async () => {
    if (!parsed) return;
    const missing = unmappedRequiredFields(mappings, kind.fields);
    if (missing.length > 0) {
      setMappingError(missing.map((f) => t('bulkRequiredUnmapped', { field: labelOf(f.key) })).join(' '));
      return;
    }
    setMappingError(null);
    setDryRun(executeDryRun(parsed, mappings, kind.fields));
    setServerCheck(null);
    setCheckFailed(false);
    setStep('dryrun');
    const verdict = await bulk.check(mapRows(parsed.rows, mappings));
    if (verdict) setServerCheck(verdict); else setCheckFailed(true);
  }, [parsed, mappings, kind.fields, t, labelOf, bulk]);

  const handleDownloadErrorReport = useCallback(() => {
    if (!dryRun?.errors.length) return;
    const csv = generateCSVErrorReport(
      dryRun.errors.map((e) => ({ rowNumber: e.rowNumber, column: e.column, reason: reasonFor(e) })),
      { rowNumber: t('bulkErrorRow'), column: t('bulkErrorColumn'), reason: t('bulkErrorReason') },
    );
    downloadText(csv, `import-errors-${kind.kind}.csv`, 'text/csv;charset=utf-8;');
  }, [dryRun, reasonFor, t, kind.kind]);

  const handleImport = useCallback(async () => {
    if (!parsed || !dryRun) return;
    const rows = mapRows(validRows, mappings);
    if (rows.length === 0) { toast.error(t('bulkNothingToImport')); return; }
    setStep('importing');
    const written = await bulk.run(rows);
    if (written) onDirtyChange?.(false);
    setStep('import-result');
  }, [parsed, dryRun, validRows, mappings, toast, t, bulk, onDirtyChange]);

  const handleDownloadSummary = useCallback(() => {
    const result = bulk.result ?? EMPTY_IMPORT_RESULT;
    const csv = generateImportSummaryReport(dryRun?.totalRows ?? 0, result.inserted, result.skipped, {
      metric: t('summaryMetric'),
      value: t('summaryValue'),
      totalRows: t('summaryTotalRows'),
      imported: t('summaryImported'),
      skipped: t('summarySkipped'),
      timestamp: t('summaryTimestamp'),
    });
    downloadText(csv, `import-summary-${kind.kind}.csv`, 'text/csv;charset=utf-8;');
  }, [bulk.result, dryRun, t, kind.kind]);

  const handleReset = useCallback(() => {
    bulk.reset();
    setStep('upload');
    setFileError(null);
    setParsed(null);
    setMappings({});
    setMappingError(null);
    setDryRun(null);
    setServerCheck(null);
    setCheckFailed(false);
    onDirtyChange?.(false);
  }, [bulk, onDirtyChange]);

  // ── Render: Upload ───────────────────────────────────────────
  if (step === 'upload') {
    return (
      <div>
        <BulkDropzone
          error={fileError}
          formats={FORMATS_LABEL}
          maxSize={formatBytes(MAX_FILE_SIZE_BYTES)}
          templateLabel={t('templateFor', { kind: kindLabel })}
          onFile={(file) => void handleFile(file)}
          onDownloadTemplate={handleDownloadTemplate}
        />
        <div style={{ ...buttonRow, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel}>{tCommon('cancel')}</Button>
        </div>
      </div>
    );
  }

  // ── Render: Mapping ──────────────────────────────────────────
  if (step === 'mapping' && parsed) {
    return (
      <div>
        <h2 style={h2Style}>{t('bulkMappingTitle')}</h2>
        <p style={bodyText}>{t('bulkMappingBody', { rows: parsed.rows.length, cols: parsed.headers.length })}</p>
        <BulkMappingTable parsed={parsed} mappings={mappings} fields={kind.fields} labelOf={labelOf} onChange={handleMappingChange} />
        {mappingError && <div style={errorBanner} role="alert">{mappingError}</div>}
        <div style={buttonRow}>
          <Button variant="secondary" onClick={() => setStep('upload')}>{t('back')}</Button>
          <div style={buttonCluster}>
            <Button variant="ghost" onClick={onCancel}>{tCommon('cancel')}</Button>
            <Button variant="primary" onClick={() => void handleRunDryRun()}>{t('bulkRunDryRun')}</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Dry-Run ──────────────────────────────────────────
  if (step === 'dryrun' && dryRun) {
    return (
      <div>
        <BulkDryRunReport
          dryRun={dryRun}
          serverCheck={serverCheck}
          checking={bulk.phase === 'checking'}
          checkFailed={checkFailed}
          reasonFor={reasonFor}
          onDownloadErrorReport={handleDownloadErrorReport}
        />
        <div style={buttonRow}>
          <Button variant="secondary" onClick={() => setStep('mapping')}>{t('back')}</Button>
          <div style={buttonCluster}>
            <Button variant="ghost" onClick={onCancel}>{tCommon('cancel')}</Button>
            <Button variant="primary" onClick={() => void handleImport()} disabled={bulk.phase === 'checking' || validRows.length === 0}>
              {t('bulkImportNow', { count: validRows.length })}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: Importing ────────────────────────────────────────
  if (step === 'importing') {
    return (
      <Surface padding="lg" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--font-size-hero)', marginBottom: 'var(--space-4)' }} aria-hidden="true"><Icon source="⏳" size="1em" /></div>
        <h2 style={h2Style}>{t('bulkImportingTitle')}</h2>
        <ImportProgressBar value={bulk.posted} max={bulk.total} label={t('bulkImportingRows', { posted: bulk.posted, total: bulk.total })} />
      </Surface>
    );
  }

  // ── Render: Import Result ────────────────────────────────────
  if (step === 'import-result') {
    const result = bulk.result ?? EMPTY_IMPORT_RESULT;
    return (
      <Surface padding="lg" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 'var(--font-size-hero)', color: bulk.failure ? 'var(--danger)' : 'var(--success)', marginBottom: 'var(--space-4)' }} aria-hidden="true">
          <Icon source={bulk.failure ? '⚠' : '✓'} size="1em" />
        </div>
        <h2 style={h2Style}>{t('bulkSuccessTitle')}</h2>
        {bulk.failure && (
          <div style={{ ...errorBanner, marginBottom: 'var(--space-5)', textAlign: 'left' }} role="alert">
            {t('bulkImportFailed', { message: bulk.failure })}
          </div>
        )}
        <ImportResultSummary result={result} onDownloadSummary={handleDownloadSummary} />
        <div style={{ ...buttonCluster, justifyContent: 'center' }}>
          <Button variant="primary" onClick={handleReset}>{t('bulkImportAnother')}</Button>
          <Button variant="secondary" onClick={onCancel}>{t('done')}</Button>
        </div>
      </Surface>
    );
  }

  return null;
}
