'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';

const KIND_COLOR: Record<string, string> = {
  workflow: '#7357ed', website: '#3978f6', chat: '#e94b9b', dashboard: '#08b59d',
  project: '#f09a3e', agent: '#8a5cf5', dataset: '#12a6c8', mockup: '#ef6d92',
};

export function DashboardCreationSessions() {
  const router = useRouter();
  const [sessions, setSessions] = useState<CreationSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    void creationSessionsApi.list().then((result) => setSessions(result.sessions)).finally(() => setLoading(false));
  }, []);
  useEffect(reload, [reload]);

  const createBlank = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const result = await creationSessionsApi.create({ title: 'Untitled session' });
      router.push(`/create/${result.session.id}`);
    } finally { setCreating(false); }
  };

  return <section style={{ marginBottom: 40 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
      <div><h2 style={{ margin: 0, fontSize: 20 }}>Create sessions</h2><p style={{ margin: '5px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>Return to a canvas and continue exactly where you left off.</p></div>
      <button onClick={createBlank} disabled={creating} className="btn btn-primary">{creating ? 'Creating…' : '+ New session'}</button>
    </div>
    {loading ? <div style={{ padding: 36, color: 'var(--text-secondary)' }}>Loading sessions…</div> : sessions.length === 0 ?
      <button onClick={createBlank} style={{ width: '100%', minHeight: 220, border: '1px dashed var(--border-default)', borderRadius: 16, background: 'var(--surface-raised)', color: 'var(--text-secondary)', cursor: 'pointer' }}><strong style={{ display: 'block', color: 'var(--text-primary)', fontSize: 18, marginBottom: 6 }}>Start with a blank canvas</strong>Describe what you want to create above, or click here.</button> :
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {sessions.map((session) => <Link key={session.id} href={`/create/${session.id}`} style={{ textDecoration: 'none', color: 'inherit', border: '1px solid var(--border-subtle)', borderRadius: 16, overflow: 'hidden', background: 'var(--surface-raised)', boxShadow: '0 4px 16px rgba(20,35,60,.05)' }}>
          <div style={{ height: 150, position: 'relative', overflow: 'hidden', background: 'radial-gradient(circle, rgba(116,137,165,.2) 1px, transparent 1px)', backgroundSize: '18px 18px' }}>
            {(session.preview?.objects ?? []).slice(0, 8).map((object, index) => <span key={object.id} title={object.title} style={{ position: 'absolute', left: `${12 + ((Math.abs(object.x) + index * 31) % 68)}%`, top: `${14 + ((Math.abs(object.y) + index * 23) % 58)}%`, width: 42, height: 26, borderRadius: 7, border: `2px solid ${KIND_COLOR[object.kind] ?? '#8291a8'}`, background: 'var(--surface-raised)', transform: 'translate(-50%, -50%)', boxShadow: '0 3px 9px #26364d22' }} />)}
            {!session.preview?.objects?.length && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Blank canvas</span>}
          </div>
          <div style={{ padding: 14 }}><strong style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{session.title}</strong><span style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, color: 'var(--text-secondary)', fontSize: 12 }}><span>{session.preview?.objectCount ?? 0} objects</span><span>{new Date(session.lastActivityAt).toLocaleDateString()}</span></span></div>
        </Link>)}
      </div>}
  </section>;
}

