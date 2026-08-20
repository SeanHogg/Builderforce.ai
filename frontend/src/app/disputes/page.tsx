'use client';

/**
 * THE DISPUTE QUEUE — the workspace's and the mediator's side of escrow mediation.
 *
 * The counterpart to `/freelancer/disputes`. Same panel, different authority: this page
 * holds the WORKSPACE token, so the client may file a position and withdraw what they
 * raised, and a caller with mediator authority may additionally take a dispute into
 * mediation and rule on it.
 *
 * ── THE AUTHORITY COMES FROM THE SERVER ──────────────────────────────────────────
 * `mediatorAuthority` is returned by the API alongside the queue and passed straight
 * into the panel. Nothing here inspects a role. That is the same discipline a
 * milestone's `actions` follow, and for the same reason: a second copy of "who may
 * rule" in the browser is a second place for the rule to drift, and the copy that
 * drifts is the one offering a Resolve button the server then refuses.
 *
 * ── WHY OPEN AND CLOSED ARE BOTH LISTED ──────────────────────────────────────────
 * A resolved dispute is the record of what was decided and how the money was split. It
 * is the thing a person comes back to look at, and a queue that hid it would send them
 * to the ledger to reconstruct a ruling from two entries.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useAuth } from '@/lib/AuthContext';
import { DisputePanel } from '@/components/disputes/DisputePanel';
import {
  fileClientStatement,
  isDisputeLive,
  listWorkspaceDisputes,
  resolveDispute,
  startMediation,
  withdrawClientDispute,
  type Dispute,
  type MediatorAuthority,
} from '@/lib/disputesApi';

export const runtime = 'edge';

export default function WorkspaceDisputesPage() {
  const t = useTranslations('disputes');
  const { user, hasTenant } = useAuth();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [authority, setAuthority] = useState<MediatorAuthority>('none');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Without a workspace token this is not a read that might fail, it is a guaranteed
    // 401 that raises the global error toast — the same gate `SellerEarnings` draws.
    if (!hasTenant) {
      setDisputes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const view = await listWorkspaceDisputes();
      setDisputes(view.disputes);
      setAuthority(view.mediatorAuthority);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [hasTenant]);

  useEffect(() => { void load(); }, [load]);

  const { live, closed } = useMemo(() => ({
    live: disputes.filter((dispute) => isDisputeLive(dispute.status)),
    closed: disputes.filter((dispute) => !isDisputeLive(dispute.status)),
  }), [disputes]);

  const actions = useMemo(() => ({
    fileStatement: async (id: number, position: string, evidence: Parameters<typeof fileClientStatement>[2]) => {
      // `asMediator` is a REQUEST, not an assertion: the server re-derives the authority
      // and files the position as `client` when the caller has none.
      await fileClientStatement(id, position, evidence, authority !== 'none');
      await load();
    },
    withdraw: async (id: number) => { await withdrawClientDispute(id); await load(); },
    startMediation: async (id: number) => { await startMediation(id); await load(); },
    resolve: async (input: {
      disputeId: number;
      outcome: Parameters<typeof resolveDispute>[0]['outcome'];
      splitFreelancerCents: number | null;
      resolution: string;
    }) => {
      await resolveDispute(input);
      await load();
    },
  }), [authority, load]);

  return (
    <PageContainer>
      <header style={{ display: 'grid', gap: 6, marginBottom: 18 }}>
        <h1 style={{
          margin: 0, fontSize: 'var(--font-size-page-title)', fontWeight: 800,
          color: 'var(--text-primary)', fontFamily: 'var(--font-display)',
        }}>{t('queueTitle')}</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {t('queueSubtitle')}
        </p>
      </header>

      {error && (
        <p role="alert" style={{ margin: '0 0 14px', color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>
          {error}
        </p>
      )}

      {!hasTenant && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {t('needsWorkspace')}
        </p>
      )}

      {hasTenant && loading && disputes.length === 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>
      )}

      {hasTenant && !loading && disputes.length === 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('noneOpen')}</p>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {live.map((dispute) => (
          <DisputePanel
            key={dispute.id}
            dispute={dispute}
            viewer="client"
            viewerRef={user?.id ?? null}
            authority={authority}
            actions={actions}
          />
        ))}
      </div>

      {closed.length > 0 && (
        <section aria-label={t('closedHeading')} style={{ display: 'grid', gap: 14, marginTop: 22 }}>
          <h2 style={{
            margin: 0, fontSize: 'var(--font-size-card-title)', fontWeight: 700,
            color: 'var(--text-primary)',
          }}>{t('closedHeading')}</h2>
          {closed.map((dispute) => (
            <DisputePanel
              key={dispute.id}
              dispute={dispute}
              viewer="client"
              viewerRef={user?.id ?? null}
              authority={authority}
              actions={actions}
            />
          ))}
        </section>
      )}
    </PageContainer>
  );
}
