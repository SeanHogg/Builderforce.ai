'use client';

/**
 * /workforce/hire — the buying surface for marketplace agents.
 *
 * A dedicated route rather than a tab on `/workforce`, for the same reason
 * `/workforce/plan` is one: the checkout return leg needs a stable path the
 * processor can redirect to (`?checkout=<session>&agent=<id>`), and a query-tab
 * address would have had to survive the processor rewriting the query string.
 *
 * It lists the PUBLIC published registry — the same `GET /api/workforce/agents`
 * the marketplace reads — and marks the ones this workspace already holds, so a
 * buyer sees "hired" rather than a button that will refuse itself. Agents the
 * workspace published are excluded: `hire` correctly 409s on your own agent, and
 * offering to sell someone their own work is not a useful button.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { useRequireAuth } from '@/lib/useRequireAuth';
import PageContainer from '@/components/PageContainer';
import { AgentCheckoutPanel } from '@/components/marketplace/AgentCheckoutPanel';
import { listAgents, listPurchasedAgents } from '@/lib/api';
import type { PublishedAgent } from '@/lib/types';

function WorkforceHirePageInner() {
  const t = useTranslations('agentCheckout');
  const allowed = useRequireAuth();
  const { tenant } = useAuth();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  const [agents, setAgents] = useState<PublishedAgent[]>([]);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // The public listing needs no login; the held set does, and a workspace
      // with none is a normal empty answer rather than a failure.
      const [published, purchased] = await Promise.all([
        listAgents(),
        listPurchasedAgents().catch(() => [] as PublishedAgent[]),
      ]);
      setAgents(published);
      setHeld(new Set(purchased.map((a) => a.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  if (!allowed) return null;

  const sellable = agents.filter((a) => tenantId == null || Number(a.tenant_id) !== tenantId);

  return (
    <PageContainer>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>{t('pageTitle')}</h1>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginTop: 4 }}>
          {t('pageSubtitle')}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            marginBottom: 14,
            fontSize: 'var(--font-size-small)',
            color: 'var(--error-text)',
            background: 'var(--error-bg)',
            border: '1px solid var(--error-border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</div>
      ) : sellable.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)', padding: 16, textAlign: 'center' }}>
          {t('empty')}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            // `auto-fit` + `minmax(0, …)` keeps the grid to one column at 360px
            // and never lets a card set a floor wider than the viewport.
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
            gap: 12,
          }}
        >
          {sellable.map((a) => (
            <AgentCheckoutPanel
              key={a.id}
              agentId={a.id}
              agentName={a.name}
              priceCents={Number(a.price_cents ?? 0)}
              pricingModel={a.pricing_model}
              priceUnit={a.price_unit}
              alreadyHired={held.has(a.id)}
              onHired={(id) => setHeld((prev) => new Set(prev).add(id))}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

/**
 * `AgentCheckoutPanel` reads the processor's redirect out of `useSearchParams`,
 * which the App Router requires a Suspense boundary for — without one the whole
 * route opts out of static rendering.
 */
export default function WorkforceHirePage() {
  return (
    <Suspense fallback={null}>
      <WorkforceHirePageInner />
    </Suspense>
  );
}
