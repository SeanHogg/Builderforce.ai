'use client';

import { useTranslations } from 'next-intl';
import { Button, Icon, Surface } from '@/components/ui';
import type { ImportResult } from '@/lib/importApi';
import type { DryRunValidation, RowValidationError } from '@/lib/importHelpers';
import { ImportStatCard } from './ImportStatCard';
import { bodyText, dangerText, errorBanner, h2Style, smallText, statGrid, tableStyle, tableWrap, tdStyle, thStyle } from './importStyles';

const MAX_SHOWN_ERRORS = 100;

/**
 * The check step: the client-side dry run (per-cell, in the reader's language)
 * beside the server's own dry run (`dryRun: true` — what it would write and
 * which rows it would skip). Two verdicts on purpose: the client one says WHICH
 * CELL, the server one is the authority on what will actually land.
 */
export function BulkDryRunReport({ dryRun, serverCheck, checking, checkFailed, reasonFor, onDownloadErrorReport }: {
  dryRun: DryRunValidation;
  serverCheck: ImportResult | null;
  checking: boolean;
  checkFailed: boolean;
  reasonFor: (error: RowValidationError) => string;
  onDownloadErrorReport: () => void;
}) {
  const t = useTranslations('import');
  const hasErrors = dryRun.errorCount > 0;
  const serverErrors = serverCheck?.errors.slice(0, MAX_SHOWN_ERRORS) ?? [];

  return (
    <div>
      <h2 style={h2Style}>{t('bulkDryRunTitle')}</h2>

      <div style={statGrid}>
        <ImportStatCard label={t('bulkTotalRows')} value={dryRun.totalRows} tone="neutral" />
        <ImportStatCard label={t('bulkValidRows')} value={dryRun.validCount} tone="success" />
        <ImportStatCard label={t('bulkErrorRows')} value={dryRun.errorCount} tone={hasErrors ? 'error' : 'neutral'} />
        {serverCheck && <ImportStatCard label={t('bulkServerWouldInsert')} value={serverCheck.inserted} tone="success" />}
      </div>

      <p style={bodyText}>
        {t('bulkDryRunSummary', { valid: dryRun.validCount, total: dryRun.totalRows, errors: dryRun.errorCount })}
      </p>

      {hasErrors && (
        <Surface padding="sm" style={{ marginBottom: 'var(--space-5)' }}>
          <div style={{ ...tableWrap, maxHeight: '20rem', overflowY: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>{t('bulkErrorRow')}</th>
                  <th style={thStyle}>{t('bulkErrorColumn')}</th>
                  <th style={thStyle}>{t('bulkErrorReason')}</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.errors.slice(0, MAX_SHOWN_ERRORS).map((err, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{err.rowNumber}</td>
                    <td style={tdStyle}>{err.column}</td>
                    <td style={{ ...tdStyle, ...dangerText }}>{reasonFor(err)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dryRun.errors.length > MAX_SHOWN_ERRORS && (
            <p style={{ ...smallText, marginTop: 'var(--space-2)', textAlign: 'center' }}>
              {t('bulkErrorTruncated', { shown: MAX_SHOWN_ERRORS, total: dryRun.errors.length })}
            </p>
          )}
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="ghost" size="sm" onClick={onDownloadErrorReport}>
              <Icon source="⬇" size="1em" /> {t('bulkDownloadErrorReport')}
            </Button>
          </div>
        </Surface>
      )}

      {checking && <p style={smallText}>{t('bulkCheckingServer')}</p>}
      {checkFailed && <div style={errorBanner} role="alert">{t('kindsLoadFailed')}</div>}
      {serverErrors.length > 0 && (
        <Surface tone="sunken" padding="md" style={{ marginBottom: 'var(--space-5)' }}>
          <h3 className="ui-text-card-title" style={{ margin: '0 0 var(--space-2)' }}>{t('bulkServerErrorsTitle')}</h3>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--font-size-small)', color: 'var(--danger-text)' }}>
            {serverErrors.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          {serverCheck && serverCheck.errors.length > serverErrors.length && (
            <p style={{ ...smallText, marginTop: 'var(--space-2)' }}>
              {t('bulkErrorTruncated', { shown: serverErrors.length, total: serverCheck.errors.length })}
            </p>
          )}
        </Surface>
      )}
    </div>
  );
}
