'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { creationSessionsApi, type CreationGraphInput } from '@/lib/builderforceApi';
import { salesApi, type SalesAssociate } from '@/lib/salesApi';
import { createTenant } from '@/lib/auth';
import styles from './salesCanvasLauncher.module.css';

function seededSalesGraph(ownerUserId: string, referralCode: string | null, salesCode: string | null): CreationGraphInput {
  const specs = [
    { kind: 'salesPipeline', title: 'Live sales pipeline', status: 'Live', x: 0, y: 0, extra: { stages: ['new', 'contacted', 'qualified', 'meeting', 'proposal', 'won', 'lost'] } },
    { kind: 'targetMarket', title: 'Target market', status: 'Researching', x: 440, y: 0, extra: {} },
    { kind: 'salesCampaign', title: 'Campaign workspace', status: 'Draft', x: 880, y: 0, extra: {} },
    { kind: 'salesGoal', title: 'Revenue & weekly goals', status: 'Active', x: 0, y: 320, extra: { outreachTarget: 50, contactsTarget: 20, meetingsTarget: 3, revenueGoalCents: 0, referralLink: referralCode ? `https://builderforce.ai/register?ref=${referralCode}` : null, salesLink: salesCode ? `https://builderforce.ai/register?ref=${salesCode}` : null } },
    { kind: 'salesMeeting', title: 'Meetings & coaching', status: 'Needs scheduling', x: 440, y: 320, extra: { durationMinutes: 30 } },
    { kind: 'agent', title: 'Sales coach', status: 'Ready', x: 880, y: 320, extra: { instructions: 'Review this associate’s live pipeline, reinforce weekly activity, identify stalled opportunities, and recommend the next best sales action.' } },
  ];
  const objects = specs.map((spec) => ({
    id: crypto.randomUUID(), kind: spec.kind, canvasData: { position: { x: spec.x, y: spec.y } },
    content: { kind: spec.kind, title: spec.title, status: spec.status, ownerUserId, ...spec.extra },
  }));
  const link = (source: number, target: number, label: string) => ({ id: crypto.randomUUID(), sourceObjectId: objects[source].id, targetObjectId: objects[target].id, kind: 'reference', label, metadata: {} });
  return { objects, connections: [link(1, 2, 'targets'), link(2, 0, 'creates leads'), link(0, 3, 'measures'), link(3, 5, 'coaches')], viewport: { x: 80, y: 80, zoom: 0.85 } };
}

export default function SalesCanvasLauncher() {
  const router = useRouter();
  const { user, hasTenant, webToken, fetchTenants, selectTenant } = useAuth();
  const [associates, setAssociates] = useState<SalesAssociate[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const provisioningRef = useRef(false);
  const canvasLaunchRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (!user.isSuperadmin) {
      if (!hasTenant) {
        if (!webToken) return;
        if (provisioningRef.current) return;
        provisioningRef.current = true;
        void (async () => {
          try {
            const existing = await fetchTenants();
            const tenant = existing[0] ?? await createTenant(webToken, `${user.name || 'My'} Sales Workspace`);
            await selectTenant(tenant);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not prepare your sales workspace.'); setBusy(false);
          } finally { provisioningRef.current = false; }
        })();
        return;
      }
      if (canvasLaunchRef.current) return;
      canvasLaunchRef.current = true;
      void (async () => {
        try {
          const existing = await salesApi.canvas();
          if (existing.sessionId) { router.replace(`/create/${existing.sessionId}`); return; }
          const created = await creationSessionsApi.create({
            title: 'Sales & Marketing Command Center',
            description: 'One shared canvas for targeting, campaigns, contacts, pipeline, meetings, goals, and coaching.',
            initialPrompt: 'Help me review my pipeline and choose the highest-impact sales action for this week.',
          });
          await creationSessionsApi.saveGraph(created.session.id, { ...seededSalesGraph(user.id, existing.referralCode, existing.salesCode), expectedRevision: created.session.revision });
          await salesApi.setCanvas(created.session.id);
          router.replace(`/create/${created.session.id}`);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not open the sales canvas.');
          setBusy(false);
          canvasLaunchRef.current = false;
        }
      })();
      return;
    }
    salesApi.associates().then(({ associates: rows }) => { setAssociates(rows); setBusy(false); }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : 'Could not load sales associates.'); setBusy(false);
    });
  }, [fetchTenants, hasTenant, router, selectTenant, user, webToken]);

  async function openAssociate(associate: SalesAssociate) {
    setBusy(true); setError(null);
    try {
      const result = await salesApi.canvas(associate.id);
      if (!result.sessionId) throw new Error(`${associate.name || associate.email} has not initialized their sales canvas yet.`);
      router.push(`/create/${result.sessionId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open the sales canvas.'); setBusy(false); }
  }

  if (!user || busy) return <main className={styles.shell}><div className={styles.card}>Opening the sales command center…</div></main>;
  if (!user.isSuperadmin) return <main className={styles.shell}><div className={styles.card}><h1>Sales canvas</h1><p>{error || 'Preparing your shared sales workspace…'}</p></div></main>;
  return <main className={styles.shell}>
    <section className={styles.card}>
      <p className={styles.eyebrow}>Superadmin collaboration</p>
      <h1>Sales associate canvases</h1>
      <p>Open an associate’s live command center to review their pipeline, collaborate on campaigns, add coaching notes, or join meeting planning.</p>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.list}>
        {associates.map((associate) => <button key={associate.id} onClick={() => void openAssociate(associate)}>
          <span>{associate.name || 'Sales associate'}</span><small>{associate.email}</small><b>Open canvas →</b>
        </button>)}
        {!associates.length && <p>No sales associates have registered yet.</p>}
      </div>
    </section>
  </main>;
}
