'use client';

export const runtime = 'edge';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { artifactAssignments, marketplaceStats, claws } from '@/lib/builderforceApi';
import { BUILTIN_PERSONAS, type Persona } from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';

export default function PersonaDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = typeof params.slug === 'string' ? decodeURIComponent(params.slug) : '';
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';
  const tenantNum = Number(tenantId);

  const [persona, setPersona] = useState<Persona | null>(null);
  const [stats, setStats] = useState<{ likes: number; installs: number; liked: boolean } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hasClaws, setHasClaws] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const p = BUILTIN_PERSONAS.find((x) => x.name === slug) ?? null;
    setPersona(p);
    if (!p) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [clawList, assignList, s] = await Promise.all([
          claws.list().catch(() => []),
          tenantNum ? artifactAssignments.list('tenant', tenantNum, 'persona').catch(() => []) : [],
          marketplaceStats.getStats('persona', [p.name]).then((r) => r[p.name] ?? { likes: 0, installs: 0, liked: false }),
        ]);
        setHasClaws(clawList.length > 0);
        setInstalled(assignList.some((a) => a.artifactSlug === p.name));
        setStats(s);
      } catch {
        setStats({ likes: 0, installs: 0, liked: false });
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, tenantNum]);

  const toggleLike = async () => {
    if (!persona || !stats) return;
    try {
      const liked = await marketplaceStats.toggleLike('persona', persona.name);
      setStats((prev) => prev ? { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) } : null);
    } catch { /* ignore */ }
  };

  const toggleInstall = async () => {
    if (!persona || !tenantNum) return;
    try {
      if (installed) {
        await artifactAssignments.unassign('persona', persona.name, 'tenant', tenantNum);
        setInstalled(false);
        setStats((prev) => prev ? { ...prev, installs: Math.max(0, prev.installs - 1) } : null);
      } else {
        await artifactAssignments.assign('persona', persona.name, 'tenant', tenantNum);
        setInstalled(true);
        setStats((prev) => prev ? { ...prev, installs: prev.installs + 1 } : null);
      }
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <div style={{ color: 'var(--muted)' }}>Loading…</div>
      </div>
    );
  }

  if (!persona) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Persona not found.</p>
        <Link href="/personas" className="btn btn-primary">Back to Personas</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <Link href="/personas" style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8, display: 'inline-block' }}>← Back to Personas</Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-strong)', margin: '8px 0' }}>{persona.name}</h1>
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>{persona.description}</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13, color: stats?.liked ? 'var(--error)' : 'var(--muted)' }} onClick={toggleLike}>
            {stats?.liked ? '❤️' : '🤍'} {stats?.likes ?? 0} likes
          </button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>⬇️ {stats?.installs ?? 0} installs</span>
          <ArtifactAssigner artifactType="persona" artifactSlug={persona.name} artifactName={persona.name} />
          <button type="button" className={`btn btn-sm ${installed ? 'btn-secondary' : 'btn-primary'}`} disabled={!hasClaws} onClick={toggleInstall}>
            {!hasClaws ? 'Register claw first' : installed ? 'Uninstall' : 'Install'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Details</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Voice</div>
            <div style={{ fontSize: 14 }}>{persona.voice}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Perspective</div>
            <div style={{ fontSize: 14 }}>{persona.perspective}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Decision Style</div>
            <div style={{ fontSize: 14 }}>{persona.decisionStyle}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Output Prefix</div>
            <code style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6, fontSize: 13 }}>{persona.outputPrefix}</code>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Capabilities</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{persona.capabilities.map((c) => <span key={c} className="badge badge-gray">{c}</span>)}</div>
          </div>
          {persona.tags && persona.tags.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{persona.tags.map((t) => <span key={t} className="badge badge-gray">{t}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
