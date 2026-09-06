'use client';

import { useTranslations } from 'next-intl';
import { Button, Icon, Surface } from '@/components/ui';
import type { ImportResult } from '@/lib/importApi';
import { ImportStatCard } from './ImportStatCard';
import { smallText, statGrid } from './importStyles';

const MAX_SHOWN_ERRORS = 100;

/**
 * The server's verdict, as the page shows it after a submit: what was written,
 * what was skipped, and the server's own line for each skipped row. The wizard
 * and the bulk import both end here — one receipt, whichever door you came in.
 *
 * The error lines are the server's text (`row N: missing required "x"`), shown
 * as-is: they are a machine report, and the localized explanation of the same
 * failure was already given by the client-side check before the post.
 */
export function ImportResultSummary({ result, onDownloadSummary }: { result: ImportResult; onDownloadSummary?: () => void }) {
  const t = useTranslations('import');
  const shown = result.errors.slice(0, MAX_SHOWN_ERRORS);
  return (
    <div>
      <div style={statGrid}>
        <ImportStatCard label={t('bulkImportedCount')} value={result.inserted} tone="success" />
        <ImportStatCard label={t('bulkSkippedCount')} value={result.skipped} tone={result.skipped > 0 ? 'error' : 'neutral'} />
        <ImportStatCard label={t('bulkTotalProcessed')} value={result.inserted + result.skipped} tone="neutral" />
      </div>

      {shown.length > 0 && (
        <Surface tone="sunken" padding="md" style={{ marginBottom: 'var(--space-6)', textAlign: 'left' }}>
          <h3 className="ui-text-card-title" style={{ margin: '0 0 var(--space-2)' }}>{t('resultErrorsTitle')}</h3>
          <ul style={{ margin: 0, paddingLeft: 'var(--space-5)', fontSize: 'var(--font-size-small)', color: 'var(--danger-text)' }}>
            {shown.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          {result.errors.length > shown.length && (
            <p style={{ ...smallText, marginTop: 'var(--space-2)' }}>
              {t('bulkErrorTruncated', { shown: shown.length, total: result.errors.length })}
            </p>
          )}
        </Surface>
      )}

      {onDownloadSummary && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <Button variant="ghost" size="sm" onClick={onDownloadSummary}>
            <Icon source="⬇" size="1em" /> {t('bulkDownloadSummary')}
          </Button>
        </div>
      )}
    </div>
  );
}
