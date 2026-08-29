'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toolsApi } from '@/lib/builderforceApi';
import { ToolResultView } from '@/components/tools/ToolResultView';
import { ReturningVisitorBanner } from '@/components/tools/ReturningVisitorBanner';
import {
  referenceAnchorId, ReferenceCard, ReferenceGrid, ReferenceGroup, ReferenceHero, ReferencePage, ReferenceSection,
} from '@/components/reference/ReferencePage';
import { getStoredTenantToken } from '@/lib/auth';
import type { ToolSummary, ToolCategory, TenantDiagnosticsRollup } from '@/lib/tools';
import { Icon } from '@/components/ui/Icon';
import { faultMessage } from '@/lib/apiClient';

// `career` sits last: the four before it diagnose a WORKSPACE and are what a
// signed-in operator came for, while the career analyzers are personal and
// arrive mostly from an article rather than from this page.
const CATEGORY_ORDER: ToolCategory[] = ['delivery', 'finops', 'governance', 'quality', 'career'];

/**
 * The diagnostics hub — a reference page (PRD 21 §11.4.5), and now built like
 * one.
 *
 * It used to lay itself out in inline styles inside `.mkt-in`: a hand-rolled
 * eyebrow/title/lede, a hand-rolled card, a hand-rolled category heading. That
 * is the fourth copy of the vocabulary `components/reference/ReferencePage`
 * exists to be, and it cost this page the two things a reference page gets for
 * free — the panel's index rail, and the reading gutter that kept its hero off
 * the drawer's left border when it opened over a board.
 *
 * The categories are the page's structure, so they are also the rail. One array
 * rendered as both: it cannot advertise a category the page stopped having, and
 * because the catalog is loaded from the API, the rail grows when a sixth
 * diagnostic ships without anyone editing a list.
 */
export default function ToolsHubClient() {
  const t = useTranslations('tools');
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [rollup, setRollup] = useState<TenantDiagnosticsRollup | null>(null);

  useEffect(() => {
    toolsApi.list()
      .then(setTools)
      .catch((e: unknown) => setError(faultMessage(e)))
      .finally(() => setLoaded(true));
    // Workspace rating (project diagnostics rolled up) — best-effort, manager+ only.
    if (getStoredTenantToken()) {
      toolsApi.rollup().then(setRollup).catch(() => setRollup(null));
    }
  }, []);

  // agentic-maturity is featured above, so keep it out of the category grid.
  const gridTools = tools.filter((tool) => tool.id !== 'agentic-maturity');
  const categories = CATEGORY_ORDER.filter((c) => gridTools.some((tool) => tool.category === c));

  return (
    <ReferencePage
      title={t('hubTitle')}
      sections={categories.map((category) => ({
        id: referenceAnchorId(category),
        label: t(`category.${category}`),
      }))}
    >
      <ReferenceHero eyebrow={t('hubEyebrow')} title={t('hubTitle')} lede={t('hubIntro')} />

      <ReferenceSection>
        {/* Returning visitor — recap their diagnostics + a targeted sign-up CTA. */}
        <ReturningVisitorBanner />

        {/* Workspace rating — project diagnostics rolled up to the tenant. */}
        {rollup && rollup.projects.length > 0 && (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <h3 className="mk-card__title">{t('rollupTitle')}</h3>
            <p className="mk-card__lede">{t('rollupDesc')}</p>
            <ToolResultView result={rollup.result} />
          </div>
        )}

        {/* Featured: the full maturity diagnostic. */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <ReferenceCard
            href="/tools/agentic-maturity"
            mark={<Icon name="insights" size={24} />}
            title={t('featuredTitle')}
            badge={t('open')}
          >
            {t('featuredDesc')}
          </ReferenceCard>
        </div>

        {error && <p className="mk-card__lede" role="alert" style={{ color: 'var(--error-text)' }}>{error}</p>}
        {!loaded ? (
          <p className="mk-card__lede">{t('loading')}</p>
        ) : (
          categories.map((category) => (
            <ReferenceGroup
              key={category}
              id={referenceAnchorId(category)}
              title={t(`category.${category}`)}
            >
              <ReferenceGrid>
                {gridTools.filter((tool) => tool.category === category).map((tool) => (
                  <ReferenceCard
                    key={tool.id}
                    href={`/tools/${tool.id}`}
                    mark={<Icon source={tool.icon} size={20} />}
                    title={tool.name}
                    badge={t(`kind.${tool.kind}`)}
                  >
                    {tool.tagline}
                  </ReferenceCard>
                ))}
              </ReferenceGrid>
            </ReferenceGroup>
          ))
        )}

        <p className="mk-card__lede">{t('hubFootnote')}</p>
      </ReferenceSection>
    </ReferencePage>
  );
}
