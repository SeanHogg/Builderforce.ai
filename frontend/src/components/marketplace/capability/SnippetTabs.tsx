import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { replaySnippets, type ReplaySiteDto, type ReplaySnippets } from '@builderforce/interaction-contract';
import { Button } from '@/components/ui';
import { useCopyToClipboard } from '@/lib/useCopyToClipboard';
import styles from './capability.module.css';

/** The install snippets as data: three pastes and the hosted-app switch. */
export const SNIPPET_TABS: ReadonlyArray<{ id: 'script' | 'npm' | 'gtm' | 'app'; field: keyof ReplaySnippets | null }> = [
  { id: 'script', field: 'scriptTag' },
  { id: 'npm', field: 'npm' },
  { id: 'gtm', field: 'gtm' },
  { id: 'app', field: null },
];

/**
 * How a site adds the loader (§4.2 step 5): script tag · npm · GTM · Builderforce
 * app. The text comes from the contract's `replaySnippets`, the one place the
 * snippet is written. A hosted site needs none — its loader is injected.
 */
export function SnippetTabs({ site }: { site: Pick<ReplaySiteDto, 'kind' | 'publicKey'> }) {
  const t = useTranslations('marketplace.capability.snippet');
  const [tab, setTab] = useState<(typeof SNIPPET_TABS)[number]['id']>(site.kind === 'hosted' ? 'app' : 'script');
  const { copy, copied } = useCopyToClipboard();
  const snippets = site.kind === 'external' && site.publicKey ? replaySnippets({ siteKey: site.publicKey }) : null;
  const active = SNIPPET_TABS.find((entry) => entry.id === tab) ?? SNIPPET_TABS[0]!;
  const text = active.field && snippets ? snippets[active.field] : null;

  return (
    <div className={styles.stack} data-testid="snippet-tabs">
      <div className={styles.tabs} role="tablist" aria-label={t('tabsLabel')}>
        {SNIPPET_TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`snippet-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            className={`${styles.tab} ${tab === entry.id ? styles.tabActive : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {t(`tabs.${entry.id}` as never)}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`snippet-tab-${active.id}`} className={styles.stack}>
        {active.field === null ? (
          <p className={styles.body}>{site.kind === 'hosted' ? t('hostedOn') : t('appHint')}</p>
        ) : text ? (
          <>
            <p className={styles.body}>{t(`hints.${active.id}` as never)}</p>
            <pre className={styles.code} data-testid="snippet-code"><code>{text}</code></pre>
            <Button variant="secondary" onClick={() => void copy(text)} aria-live="polite">
              {copied ? t('copied') : t('copy')}
            </Button>
          </>
        ) : (
          <p className={styles.body}>{site.kind === 'hosted' ? t('hostedOn') : t('noKey')}</p>
        )}
      </div>
    </div>
  );
}
