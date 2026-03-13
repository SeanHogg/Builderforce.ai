'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  artifactAssignments,
  listMarketplaceSkills,
  type ArtifactAssignment,
} from '@/lib/builderforceApi';
import { BUILTIN_SKILLS, type BuiltinSkill } from '@/lib/marketplaceData';

export interface SkillAssignmentsContentProps {
  scope: 'tenant' | 'claw' | 'project' | 'task';
  scopeId: number;
  className?: string;
  style?: React.CSSProperties;
}

type MergedSkill = {
  slug: string;
  name: string;
  description: string;
  category?: string;
  emoji?: string;
};

export function SkillAssignmentsContent({ scope, scopeId, className, style }: SkillAssignmentsContentProps) {
  const [assigned, setAssigned] = useState<ArtifactAssignment[]>([]);
  const [catalog, setCatalog] = useState<MergedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, apiRes] = await Promise.all([
        artifactAssignments.list(scope, scopeId, 'skill').catch(() => []),
        listMarketplaceSkills({ limit: 100 }).catch(() => ({ skills: [] })),
      ]);
      setAssigned(list);

      const apiSkills = (apiRes.skills ?? []).map((s) => ({
        slug: s.slug,
        name: s.name,
        description: s.description ?? '',
        category: s.category ?? undefined,
      }));
      const apiSet = new Set(apiSkills.map((s) => s.slug));
      const builtins: MergedSkill[] = BUILTIN_SKILLS.filter((b) => !apiSet.has(b.slug)).map((b) => ({
        slug: b.slug,
        name: b.name,
        description: b.description,
        category: b.category,
        emoji: b.emoji,
      }));
      setCatalog([...apiSkills, ...builtins]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [scope, scopeId]);

  useEffect(() => { load(); }, [load]);

  const assignedSlugs = new Set(assigned.map((a) => a.artifactSlug));

  const handleAssign = async (slug: string) => {
    setError(null);
    try {
      await artifactAssignments.assign('skill', slug, scope, scopeId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assign failed');
    }
  };

  const handleUnassign = async (slug: string) => {
    setError(null);
    try {
      await artifactAssignments.unassign('skill', slug, scope, scopeId);
      setAssigned((prev) => prev.filter((a) => a.artifactSlug !== slug));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unassign failed');
    }
  };

  const unassignedCatalog = catalog.filter(
    (s) => !assignedSlugs.has(s.slug) && (!search || s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 12, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Skills ({assigned.length})</div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            background: 'var(--coral-bright)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {showAdd ? 'Done' : '+ Assign Skill'}
        </button>
      </div>

      {error && <div style={{ padding: '8px 12px', fontSize: 12, background: 'rgba(239,68,68,0.15)', color: '#ef4444', borderRadius: 8 }}>{error}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : showAdd ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="text"
            placeholder="Search skills…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              padding: '8px 10px',
              fontSize: 13,
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              background: 'var(--bg-deep)',
              color: 'var(--text-primary)',
            }}
          />
          {unassignedCatalog.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>No additional skills to assign</div>
          ) : (
            unassignedCatalog.slice(0, 20).map((s) => (
              <div
                key={s.slug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{s.emoji ?? '✨'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleAssign(s.slug)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'var(--coral-bright)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Assign
                </button>
              </div>
            ))
          )}
        </div>
      ) : assigned.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
          No skills assigned. Click &quot;+ Assign Skill&quot; to add skills.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {assigned.map((a) => {
            const info = catalog.find((s) => s.slug === a.artifactSlug) ?? BUILTIN_SKILLS.find((b: BuiltinSkill) => b.slug === a.artifactSlug);
            const name = info?.name ?? a.artifactSlug;
            const emoji = (info as MergedSkill | BuiltinSkill | undefined)?.emoji ?? '✨';
            return (
              <div
                key={a.artifactSlug}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 16, flexShrink: 0 }}>{emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Assigned {new Date(a.assignedAt).toLocaleDateString()}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUnassign(a.artifactSlug)}
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'rgba(239,68,68,0.1)',
                    color: '#ef4444',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 6,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
