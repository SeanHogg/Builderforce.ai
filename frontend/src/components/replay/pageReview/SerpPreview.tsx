/**
 * An SEO meta change as a search result (PRD 33 §5.2 "Render"): how the page reads
 * in a search result before and after the fix — title, URL, description — and the
 * proposed JSON-LD as a diff. Text only, from `visual.serp` / `visual.jsonLdDiff`;
 * nothing here is fetched or invented.
 */

import { useTranslations } from 'next-intl';
import type { ReplaySerpSnippet, ReplayVisualDto } from '@builderforce/interaction-contract';

function Snippet({ snippet, label }: { snippet: ReplaySerpSnippet; label: string }) {
  return (
    <figure data-testid="serp-snippet" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 2, padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface-card)', minWidth: 0 }}>
      <figcaption style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</figcaption>
      <span data-part="url" style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{snippet.url}</span>
      <span data-part="title" style={{ color: 'var(--accent)', fontSize: 'var(--font-size-card-title)', overflowWrap: 'anywhere' }}>{snippet.title}</span>
      <span data-part="description" style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{snippet.description}</span>
    </figure>
  );
}

export function SerpPreview({ visual }: { visual: Pick<ReplayVisualDto, 'serp' | 'jsonLdDiff'> }) {
  const t = useTranslations('replay.page.serp');
  if (!visual.serp && !visual.jsonLdDiff) return null;
  return (
    <section aria-label={t('title')} data-testid="serp-preview" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 0 }}>
      {visual.serp && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-2)' }}>
          <Snippet snippet={visual.serp.before} label={t('before')} />
          <Snippet snippet={visual.serp.after} label={t('after')} />
        </div>
      )}
      {visual.jsonLdDiff && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
          <strong style={{ fontSize: 'var(--font-size-small)' }}>{t('jsonLdTitle')}</strong>
          <pre
            data-testid="jsonld-diff"
            aria-label={t('jsonLdAria')}
            style={{ margin: 0, padding: 'var(--space-2)', maxHeight: 240, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)' }}
          >
            {visual.jsonLdDiff}
          </pre>
        </div>
      )}
    </section>
  );
}
