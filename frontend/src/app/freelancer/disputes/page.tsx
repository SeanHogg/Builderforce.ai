'use client';

/**
 * MY DISPUTES — the worker's half of mediation.
 *
 * Lists every dispute this person is party to across every workspace that has hired
 * them, including the ones the CLIENT raised: those are the ones they most need to
 * answer, and a list filtered by who raised it would hide exactly them.
 *
 * There is no Resolve control here and there never will be. A party to a dispute cannot
 * rule on it; the mediator's surface is `/api/disputes` behind the workspace token. The
 * panel is handed no `resolve` action at all, so the absence is structural rather than a
 * button somebody remembered to hide.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useAuth } from '@/lib/AuthContext';
import { DisputePanel } from '@/components/disputes/DisputePanel';
import {
  fileMyStatement,
  listMyDisputes,
  withdrawMyDispute,
  type Dispute,
} from '@/lib/disputesApi';

export const runtime = 'edge';

export default function FreelancerDisputesPage() {
  const t = useTranslations('disputes');
  const { user } = useAuth();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDisputes(await listMyDisputes());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <PageContainer>
      <header style={{ display: 'grid', gap: 6, marginBottom: 18 }}>
        <h1 style={{
          margin: 0, fontSize: 'var(--font-size-page-title)', fontWeight: 800,
          color: 'var(--text-primary)', fontFamily: 'var(--font-display)',
        }}>{t('pageTitle')}</h1>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
          {t('pageSubtitle')}
        </p>
        <Link href="/freelancer/earnings" style={{ color: 'var(--cyan-bright)', fontSize: 'var(--font-size-small)' }}>
          {t('earningsLink')}
        </Link>
      </header>

      {error && (
        <p role="alert" style={{ margin: '0 0 14px', color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>
          {error}
        </p>
      )}

      {loading && disputes.length === 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('loading')}</p>
      )}

      {!loading && disputes.length === 0 && (
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('noneOpen')}</p>
      )}

      <div style={{ display: 'grid', gap: 14 }}>
        {disputes.map((dispute) => (
          <DisputePanel
            key={dispute.id}
            dispute={dispute}
            viewer="freelancer"
            viewerRef={user?.id ?? null}
            actions={{
              fileStatement: async (id, position, evidence) => {
                await fileMyStatement(id, position, evidence);
                await load();
              },
              withdraw: async (id) => {
                await withdrawMyDispute(id);
                await load();
              },
            }}
          />
        ))}
      </div>
    </PageContainer>
  );
}
