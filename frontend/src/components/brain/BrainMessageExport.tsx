'use client';

/**
 * "Download as …" for a capability reply — the action that makes a Document,
 * Slides, or Spreadsheet chat produce something usable outside the chat.
 *
 * Self-gating: the capability decides the format (and whether there is one at
 * all), so the consumer just passes the chat's capability and the message text.
 * IDE capabilities have no export — they already emit real files via path-tagged
 * code blocks — and a CSV export hides itself when the reply has no table yet.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getBrainCapability, extractCsv, exportFilenameStem } from '@/lib/brain';
import { exportDocx, exportPptx, exportCsv } from '@/lib/exportApi';
import { Icon } from '@/components/ui/Icon';

export interface BrainMessageExportProps {
  /** The chat's capability id (null = no capability picked). */
  capability?: string | null;
  /** The assistant reply being exported. */
  content: string;
  /** Chat title — becomes the document title and the filename stem. */
  title?: string;
}

export function BrainMessageExport({ capability, content, title }: BrainMessageExportProps) {
  const t = useTranslations('brain.capabilities');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);

  const format = getBrainCapability(capability)?.exportFormat;
  if (!format) return null;

  // A CSV export is only real once the reply actually contains rows.
  const csv = format === 'csv' ? extractCsv(content) : null;
  if (format === 'csv' && !csv) return null;

  const label = t(`export.${format}`);
  const run = async () => {
    setBusy(true);
    setError('');
    setDownloaded(false);
    try {
      const name = title?.trim() || t('export.untitled');
      if (format === 'csv') exportCsv(csv as string, `${exportFilenameStem(name, 'export')}.csv`);
      else if (format === 'docx') await exportDocx(content, name);
      else await exportPptx(content, name);
      setDownloaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('export.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="bs-action-btn bs-action-btn--icon"
      onClick={() => { void run(); }}
      disabled={busy}
      title={error || (downloaded ? t('export.downloaded') : label)}
      aria-label={error || (downloaded ? t('export.downloaded') : label)}
      data-state={error ? 'error' : downloaded ? 'complete' : busy ? 'working' : 'idle'}
    >
      <Icon name={busy ? 'clock' : error ? 'warning' : downloaded ? 'document' : 'download'} size={15} />
    </button>
  );
}
