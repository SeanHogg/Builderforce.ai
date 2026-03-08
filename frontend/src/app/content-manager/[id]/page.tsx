'use client';

export const runtime = 'edge';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/lib/AuthContext';
import { marketplaceStats } from '@/lib/builderforceApi';
import { contentStorageKey } from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';

interface ContentBlock {
  id: string;
  title: string;
  type: string;
  status: string;
  body: string;
  variant?: { id: string; label: string; body: string } | null;
  tags: string[];
  sharedToMarketplace?: boolean;
  image?: string;
  likes?: number;
  downloads?: number;
  updatedAt: string;
}

function loadBlocks(tenantId: string): ContentBlock[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(contentStorageKey(tenantId));
    return raw ? (JSON.parse(raw) as ContentBlock[]) : [];
  } catch {
    return [];
  }
}

export default function ContentDetailPage() {
  const params = useParams();
  const id = typeof params.id === 'string' ? decodeURIComponent(params.id) : '';
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? '';

  const [block, setBlock] = useState<ContentBlock | null>(null);
  const [stats, setStats] = useState<{ likes: number; installs: number; liked: boolean } | null>(null);

  useEffect(() => {
    const blocks = loadBlocks(tenantId);
    const b = blocks.find((x) => x.id === id) ?? null;
    setBlock(b);
    if (b?.sharedToMarketplace) {
      marketplaceStats.getStats('content', [b.id]).then((r) => setStats(r[b.id] ?? { likes: 0, installs: 0, liked: false })).catch(() => setStats({ likes: 0, installs: 0, liked: false }));
    } else if (b) {
      setStats({ likes: b.likes ?? 0, installs: b.downloads ?? 0, liked: false });
    }
  }, [id, tenantId]);

  const toggleLike = async () => {
    if (!block || !stats) return;
    try {
      const liked = await marketplaceStats.toggleLike('content', block.id);
      setStats((prev) => prev ? { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) } : null);
    } catch { /* ignore */ }
  };

  if (!block) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Content not found.</p>
        <Link href="/content-manager" className="btn btn-primary">Back to Content Manager</Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <Link href="/content-manager" style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8, display: 'inline-block' }}>← Back to Content Manager</Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-strong)', margin: '8px 0' }}>{block.title}</h1>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <span className="badge badge-gray">{block.type}</span>
          <span className={`badge ${block.status === 'published' ? 'badge-green' : 'badge-yellow'}`}>{block.status}</span>
          {block.tags.map((t) => <span key={t} className="badge badge-gray">{t}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13, color: stats?.liked ? '#ef4444' : 'var(--muted)' }} onClick={toggleLike}>
            {stats?.liked ? '❤️' : '🤍'} {stats?.likes ?? 0} likes
          </button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>⬇️ {stats?.installs ?? 0} installs</span>
          <ArtifactAssigner artifactType="content" artifactSlug={block.id} artifactName={block.title} />
        </div>
      </div>

      {block.image && (
        <div style={{ width: '100%', maxHeight: 240, borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
          <img src={block.image} alt="" style={{ width: '100%', height: 'auto', objectFit: 'cover' }} />
        </div>
      )}

      <div className="card" style={{ padding: 24 }}>
        <div className="md-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.body}</ReactMarkdown>
        </div>
        {block.variant && (
          <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{block.variant.label}</h3>
            <div className="md-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.variant.body}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 16 }}>Updated {new Date(block.updatedAt).toLocaleString()}</div>
    </div>
  );
}
