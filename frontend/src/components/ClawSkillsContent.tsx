'use client';

import { useState, useEffect } from 'react';
import {
  clawSkillsApi,
  listMarketplaceSkills,
  type ClawSkillAssignment,
  type MarketplaceSkill,
} from '@/lib/builderforceApi';

interface ClawSkillsContentProps {
  clawId: number;
  tenantId?: number | null;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export function ClawSkillsContent({ clawId, tenantId }: ClawSkillsContentProps) {
  const [assignments, setAssignments] = useState<ClawSkillAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    clawSkillsApi
      .list(clawId)
      .then(setAssignments)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [clawId]);

  useEffect(() => {
    if (!showAdd) return;
    listMarketplaceSkills({ q: searchQ || undefined, limit: 30 })
      .then((r) => setMarketplaceSkills(r.skills))
      .catch(() => {});
  }, [showAdd, searchQ]);

  const handleAssign = async (skillSlug: string) => {
    setAdding(skillSlug);
    try {
      await clawSkillsApi.assignToClaw(clawId, skillSlug);
      load();
    } catch {
      // ignore
    } finally {
      setAdding(null);
    }
  };

  const handleRevoke = async (assignmentId: number) => {
    setRevoking(assignmentId);
    try {
      await clawSkillsApi.revoke(assignmentId);
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    } catch {
      // ignore
    } finally {
      setRevoking(null);
    }
  };

  const assignedSlugs = new Set(assignments.map((a) => a.skillSlug));

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading skills…</div>;
  if (error) return <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>;

  const tenantAssignments = assignments.filter((a) => a.scope === 'tenant');
  const clawAssignments = assignments.filter((a) => a.scope === 'claw');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Skills ({assignments.length})
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          style={{
            padding: '5px 12px',
            fontSize: 12,
            fontWeight: 600,
            background: showAdd ? 'var(--bg-base)' : 'var(--surface-interactive)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {showAdd ? 'Cancel' : '+ Add Skill'}
        </button>
      </div>

      {showAdd && (
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Add from Marketplace</div>
          <input
            type="text"
            placeholder="Search skills…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            style={{
              padding: '8px 12px',
              fontSize: 13,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {marketplaceSkills.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 8 }}>
                No skills found.
              </div>
            )}
            {marketplaceSkills.map((skill) => {
              const alreadyAssigned = assignedSlugs.has(skill.slug);
              return (
                <div
                  key={skill.slug}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--bg-elevated)',
                    opacity: alreadyAssigned ? 0.5 : 1,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{skill.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                      {skill.slug}
                      {skill.category ? ` · ${skill.category}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={alreadyAssigned || adding === skill.slug}
                    onClick={() => handleAssign(skill.slug)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      background: alreadyAssigned ? 'var(--bg-elevated)' : 'var(--coral-bright, #f4726e)',
                      color: alreadyAssigned ? 'var(--text-muted)' : '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: alreadyAssigned || adding === skill.slug ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {adding === skill.slug ? '…' : alreadyAssigned ? 'Added' : 'Add'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tenant-level assignments */}
      {tenantAssignments.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            Tenant-wide
          </div>
          {tenantAssignments.map((a) => (
            <div key={a.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {a.skill?.name ?? a.skillSlug}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {a.skillSlug}
                  {a.skill?.category ? ` · ${a.skill.category}` : ''}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-muted)',
                }}
              >
                Tenant
              </span>
            </div>
          ))}
        </>
      )}

      {/* Claw-level assignments */}
      {clawAssignments.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
            Claw-specific
          </div>
          {clawAssignments.map((a) => (
            <div key={a.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {a.skill?.name ?? a.skillSlug}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {a.skillSlug}
                  {a.skill?.category ? ` · ${a.skill.category}` : ''}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'rgba(0,229,204,0.12)',
                  color: 'var(--cyan-bright, #00e5cc)',
                }}
              >
                Claw
              </span>
              <button
                type="button"
                onClick={() => handleRevoke(a.id)}
                disabled={revoking === a.id}
                style={{
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'none',
                  color: 'var(--coral-bright, #f4726e)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  cursor: revoking === a.id ? 'wait' : 'pointer',
                }}
              >
                {revoking === a.id ? '…' : 'Revoke'}
              </button>
            </div>
          ))}
        </>
      )}

      {assignments.length === 0 && !showAdd && (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No skills assigned. Click &ldquo;Add Skill&rdquo; to assign skills from the marketplace.
        </div>
      )}
    </div>
  );
}
