'use client';

export const runtime = 'edge';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { artifactAssignments, marketplaceStats, claws, listMarketplaceSkills } from '@/lib/builderforceApi';
import { BUILTIN_SKILLS, type BuiltinSkill } from '@/lib/marketplaceData';
import ArtifactAssigner from '@/components/ArtifactAssigner';

export default function SkillDetailPage() {
  const params = useParams();
  const slug = typeof params.slug === 'string' ? decodeURIComponent(params.slug) : '';
  const { tenant } = useAuth();
  const tenantNum = Number(tenant?.id ?? 0);

  const [skill, setSkill] = useState<BuiltinSkill | { name: string; slug: string; description: string; category?: string; author?: string; version?: string } | null>(null);
  const [stats, setStats] = useState<{ likes: number; installs: number; liked: boolean } | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hasClaws, setHasClaws] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const builtin = BUILTIN_SKILLS.find((x) => x.slug === slug) ?? null;
    if (builtin) {
      setSkill(builtin);
      (async () => {
        try {
          const [clawList, assignList, s] = await Promise.all([
            claws.list().catch(() => []),
            tenantNum ? artifactAssignments.list('tenant', tenantNum, 'skill').catch(() => []) : [],
            marketplaceStats.getStats('skill', [slug]).then((r) => r[slug] ?? { likes: 0, installs: 0, liked: false }),
          ]);
          setHasClaws(clawList.length > 0);
          setInstalled(assignList.some((a) => a.artifactSlug === slug));
          setStats(s);
        } catch {
          setStats({ likes: 0, installs: 0, liked: false });
        } finally {
          setLoading(false);
        }
      })();
      return;
    }
    (async () => {
      try {
        const res = await listMarketplaceSkills({ limit: 200 });
        const apiSkill = (res.skills ?? []).find((s) => s.slug === slug);
        if (apiSkill) {
          setSkill({
            name: apiSkill.name,
            slug: apiSkill.slug,
            description: apiSkill.description ?? '',
            category: apiSkill.category ?? undefined,
            author: apiSkill.author_username ?? apiSkill.author_display_name ?? undefined,
            version: apiSkill.version ?? undefined,
          });
        }
        const [clawList, assignList, s] = await Promise.all([
          claws.list().catch(() => []),
          tenantNum ? artifactAssignments.list('tenant', tenantNum, 'skill').catch(() => []) : [],
          marketplaceStats.getStats('skill', [slug]).then((r) => r[slug] ?? { likes: 0, installs: 0, liked: false }),
        ]);
        setHasClaws(clawList.length > 0);
        setInstalled(assignList.some((a) => a.artifactSlug === slug));
        setStats(s);
      } catch {
        setStats({ likes: 0, installs: 0, liked: false });
      } finally {
        setLoading(false);
      }
    })();
  }, [slug, tenantNum]);

  const toggleLike = async () => {
    if (!skill || !stats) return;
    try {
      const liked = await marketplaceStats.toggleLike('skill', skill.slug);
      setStats((prev) => prev ? { ...prev, liked, likes: liked ? prev.likes + 1 : Math.max(0, prev.likes - 1) } : null);
    } catch { /* ignore */ }
  };

  const toggleInstall = async () => {
    if (!skill || !tenantNum) return;
    try {
      if (installed) {
        await artifactAssignments.unassign('skill', skill.slug, 'tenant', tenantNum);
        setInstalled(false);
        setStats((prev) => prev ? { ...prev, installs: Math.max(0, prev.installs - 1) } : null);
      } else {
        await artifactAssignments.assign('skill', skill.slug, 'tenant', tenantNum);
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

  if (!skill) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <p style={{ color: 'var(--muted)', marginBottom: 16 }}>Skill not found.</p>
        <Link href="/skills" className="btn btn-primary">Back to Skills</Link>
      </div>
    );
  }

  const builtin = BUILTIN_SKILLS.find((b) => b.slug === slug);
  const emoji = builtin?.emoji ?? '✨';

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <Link href="/skills" style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 8, display: 'inline-block' }}>← Back to Skills</Link>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-strong)', margin: '8px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 32 }}>{emoji}</span>
          {skill.name}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--muted)' }}>{skill.description}</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 13, color: stats?.liked ? 'var(--error)' : 'var(--muted)' }} onClick={toggleLike}>
            {stats?.liked ? '❤️' : '🤍'} {stats?.likes ?? 0} likes
          </button>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>⬇️ {stats?.installs ?? 0} installs</span>
          <ArtifactAssigner artifactType="skill" artifactSlug={skill.slug} artifactName={skill.name} />
          <button type="button" className={`btn btn-sm ${installed ? 'btn-secondary' : 'btn-primary'}`} disabled={!hasClaws} onClick={toggleInstall}>
            {!hasClaws ? 'Register claw first' : installed ? 'Uninstall' : 'Install'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Details</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Slug</div>
            <code style={{ background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6, fontSize: 13 }}>{skill.slug}</code>
          </div>
          {'category' in skill && skill.category && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Category</div>
              <div style={{ fontSize: 14 }}>{skill.category}</div>
            </div>
          )}
          {'version' in skill && skill.version && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Version</div>
              <div style={{ fontSize: 14 }}>{skill.version}</div>
            </div>
          )}
          {'author' in skill && skill.author && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Author</div>
              <div style={{ fontSize: 14 }}>{skill.author}</div>
            </div>
          )}
          {builtin && builtin.tags.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{builtin.tags.map((t) => <span key={t} className="badge badge-gray">{t}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
