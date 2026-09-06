'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon, Surface } from '@/components/ui';
import { ACCEPTED_EXTENSIONS } from '@/lib/importHelpers';
import { bodyText, errorBanner, h2Style, smallText } from './importStyles';

const ACCEPT = [...ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`), 'text/csv', 'text/tab-separated-values', 'application/json'].join(',');

/**
 * The upload step: a drop target, a file picker behind it, the kind's template
 * to download, and whatever went wrong with the last file.
 */
export function BulkDropzone({ error, formats, maxSize, templateLabel, onFile, onDownloadTemplate }: {
  error: string | null;
  /** Human list of accepted formats, for the hint. */
  formats: string;
  /** Formatted size cap, for the hint. */
  maxSize: string;
  templateLabel: string;
  onFile: (file: File) => void;
  onDownloadTemplate: () => void;
}) {
  const t = useTranslations('import');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
        <h2 style={{ ...h2Style, margin: 0 }}>{t('bulkUploadTitle')}</h2>
        <Button variant="ghost" size="sm" onClick={onDownloadTemplate}>
          <Icon source="⬇" size="1em" /> {templateLabel}
        </Button>
      </div>

      <Surface
        padding="lg"
        interactive
        role="button"
        tabIndex={0}
        aria-label={t('bulkUploadAria')}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        style={{
          textAlign: 'center',
          cursor: 'pointer',
          borderStyle: 'dashed',
          borderColor: dragOver ? 'var(--accent)' : undefined,
          background: dragOver ? 'var(--surface-raised)' : undefined,
        }}
      >
        <div style={{ fontSize: 'var(--font-size-hero)', marginBottom: 'var(--space-3)' }} aria-hidden="true"><Icon source="📁" size="1em" /></div>
        <p style={{ ...bodyText, color: 'var(--text-primary)', fontWeight: 600, margin: '0 0 var(--space-2)' }}>{t('bulkDropzoneTitle')}</p>
        <p style={smallText}>{t('bulkDropzoneHint', { formats, maxSize })}</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </Surface>

      {error && <div style={errorBanner} role="alert">{error}</div>}
    </div>
  );
}
