'use client';

/**
 * The review queue for skills this workspace's agents proposed.
 *
 * A run that reached a verified result can now distil what it did into a skill
 * DRAFT. This is the gate that decides whether a draft ever reaches another
 * agent's prompt — nothing an agent writes takes effect until someone approves it
 * here, so the panel deliberately shows the whole body and the run that proposed
 * it rather than a preview and a slug.
 *
 * Self-contained: it owns its fetch, decides its own entitlement, and renders
 * nothing when the workspace has no proposals — so it can sit on any surface.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { useConfirm } from '@/components/ConfirmProvider';
import { usePermission } from '@/lib/rbac';
import { faultMessage } from '@/lib/apiClient';
import { workspaceSkillsApi, type WorkspaceSkill, type WorkspaceSkillStatus } from '@/lib/workspaceSkillsApi';

const FILTERS: readonly WorkspaceSkillStatus[] = ['draft', 'approved', 'rejected'];

const card: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--bg-base)',
  padding: 16,
  marginBottom: 12,
};
const button: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: '7px 12px',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  cursor: 'pointer',
};
const body: React.CSSProperties = {
  background: 'var(--bg-deep)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 12,
  margin: '10px 0 0',
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-primary)',
  whiteSpace: 'pre-wrap',
  overflowX: 'auto',
  maxHeight: 320,
};

const STATUS_COLOR: Record<WorkspaceSkillStatus, string> = {
  draft: 'var(--warning)',
  approved: 'var(--success)',
  rejected: 'var(--text-muted)',
};

export function WorkspaceSkillReview() {
  const t = useTranslations('workspaceSkills');
  const confirm = useConfirm();
  const { allowed } = usePermission('integrations.manage');
  const [status, setStatus] = useState<WorkspaceSkillStatus>('draft');
  const [skills, setSkills] = useState<WorkspaceSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSkills(await workspaceSkillsApi.list(status));
      setError(null);
    } catch (e) {
      setError(faultMessage(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (skill: WorkspaceSkill, decision: 'approved' | 'rejected') => {
    if (decision === 'approved' && !(await confirm({ message: t('confirmApprove', { name: skill.name }), destructive: false }))) return;
    setBusyId(skill.id);
    try {
      await workspaceSkillsApi.review(skill.id, decision);
      await load();
    } catch (e) {
      setError(faultMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (skill: WorkspaceSkill) => {
    if (!(await confirm({ message: t('confirmDelete', { name: skill.name }), destructive: true }))) return;
    setBusyId(skill.id);
    try {
      await workspaceSkillsApi.remove(skill.id);
      await load();
    } catch (e) {
      setError(faultMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '0 0 12px' }}>{t('intro')}</p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
            style={{ ...button, background: status === value ? 'var(--coral-bright)' : 'var(--bg-elevated)', color: status === value ? 'var(--text-on-accent)' : 'var(--text-secondary)' }}
          >
            {t(`filter.${value}`)}
          </button>
        ))}
      </div>

      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>{error}</p>}

      {loading ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t('loading')}</p>
      ) : skills.length === 0 ? (
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>{t(`empty.${status}`)}</p>
      ) : (
        skills.map((skill) => (
          <article key={skill.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <strong style={{ color: 'var(--text-primary)' }}>{skill.name}</strong>
                <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{skill.description}</p>
              </div>
              <span style={{ color: STATUS_COLOR[skill.status], fontSize: 'var(--font-size-eyebrow)', fontWeight: 650 }}>● {t(`filter.${skill.status}`)}</span>
            </div>

            <p style={{ margin: '8px 0 0', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
              {skill.authorKind === 'agent'
                ? t('proposedByAgent', { agent: skill.authorLabel ?? t('unknownAgent'), run: skill.originExecutionId ?? 0 })
                : t('writtenByPerson')}
            </p>
            {skill.evidence && (
              <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-secondary)' }}>{t('evidence', { evidence: skill.evidence })}</p>
            )}

            <pre style={body}>{skill.body}</pre>

            <RoleGate capability="integrations.manage" variant="inline">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {skill.status !== 'approved' && (
                  <button type="button" style={button} disabled={busyId === skill.id || !allowed} onClick={() => void decide(skill, 'approved')}>{t('approve')}</button>
                )}
                {skill.status !== 'rejected' && (
                  <button type="button" style={button} disabled={busyId === skill.id || !allowed} onClick={() => void decide(skill, 'rejected')}>{t('reject')}</button>
                )}
                <button type="button" style={{ ...button, color: 'var(--danger)' }} disabled={busyId === skill.id || !allowed} onClick={() => void remove(skill)}>{t('delete')}</button>
              </div>
            </RoleGate>
          </article>
        ))
      )}
    </section>
  );
}
