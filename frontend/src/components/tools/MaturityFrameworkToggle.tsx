import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toolsApi } from '@/lib/builderforceApi';
import type { MaturityFrameworkSummary } from '@/lib/tools';

/**
 * Which vocabulary a maturity scorecard is reported in — CMMI practices, COBIT
 * domains, or the ITIL service value chain.
 *
 * SELF-GATING, in the house convention: it fetches the registry itself and
 * renders nothing when the server offers fewer than two lenses, so no caller has
 * to know whether a toggle is warranted. The parent owns the selected value
 * because BOTH modes of the runner — the self-assessment and the "from your
 * data" panel — must report under the same lens; a reader who switches to COBIT
 * and then to telemetry, and lands back on practices, has been shown two
 * different taxonomies for one organization.
 *
 * The list is fetched, not hardcoded: the frameworks are a server-side registry
 * so a new one appears here with no frontend change.
 *
 * No `'use client'` of its own: its only consumer is the runner, which already
 * declared one, so the directive would add a file to the client boundary count
 * without moving the boundary.
 */
export function MaturityFrameworkToggle({ value, onChange }: {
  value: string;
  onChange: (framework: string) => void;
}) {
  const t = useTranslations('tools');
  const [frameworks, setFrameworks] = useState<MaturityFrameworkSummary[]>([]);

  useEffect(() => {
    let alive = true;
    // A failure leaves the list empty and the toggle hidden — the diagnostic still
    // scores, in its own vocabulary. A lens is a way to READ a result, so losing
    // it must never cost the result.
    toolsApi.maturityFrameworks()
      .then((list) => { if (alive) setFrameworks(list); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (frameworks.length < 2) return null;
  const active = frameworks.find((f) => f.id === value) ?? frameworks[0]!;

  return (
    <div style={{ marginBottom: 18 }}>
      <div
        role="radiogroup"
        aria-label={t('frameworkLabel')}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
        }}
      >
        {frameworks.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={f.id === active.id}
            onClick={() => onChange(f.id)}
            style={{
              flex: '1 1 120px',
              padding: '8px 12px',
              fontSize: 'var(--font-size-small)',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: f.id === active.id ? 'var(--accent)' : 'transparent',
              color: f.id === active.id ? 'var(--text-on-accent)' : 'var(--text-strong)',
            }}
          >
            {f.name}
          </button>
        ))}
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {active.tagline} {t('frameworkHint')}
      </p>
    </div>
  );
}
