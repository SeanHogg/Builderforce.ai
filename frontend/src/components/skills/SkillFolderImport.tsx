/**
 * "Import skill folder" — bring an Agent Skills folder written anywhere (Claude Code's
 * `.claude/skills`, a repo's `.agents/skills`, a .zip from a colleague) into this
 * workspace, scripts and references included.
 *
 * Self-contained: it owns its panel, its entitlement (manager-level, like a review —
 * importing signs the skill off) and its call; the host only learns that a skill
 * landed, through `onImported`, so it can refresh what it shows.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { usePermission } from '@/lib/rbac';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { SkillFolderRejected, workspaceSkillsApi } from '@/lib/workspaceSkillsApi';
import { SkillFolderPicker, SkillIssueList, type PickedSkill } from './SkillFolderPicker';
import type { SkillIssue } from '@builderforce/agent-skills';

const primary: React.CSSProperties = {
  border: '1px solid var(--coral-bright)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 14px',
  minHeight: 36,
  background: 'var(--coral-bright)',
  color: 'var(--text-on-accent)',
  fontSize: 'var(--font-size-small)',
  fontWeight: 650,
  cursor: 'pointer',
};

export function SkillFolderImport({ onImported }: { onImported?: () => void }) {
  const t = useTranslations('skillFolder');
  const errorMessage = useErrorMessage();
  const { allowed } = usePermission('integrations.manage');
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedSkill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<SkillIssue[]>([]);
  const [done, setDone] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setPicked(null);
    setError(null);
    setRefusal([]);
    setDone(null);
  };

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    setRefusal([]);
    try {
      const r = await workspaceSkillsApi.importFolder(picked.files);
      setDone(t(r.outcome === 'replaced' ? 'replaced' : 'imported', { name: r.skill.slug }));
      setPicked(null);
      onImported?.();
    } catch (e) {
      if (e instanceof SkillFolderRejected) setRefusal(e.issues);
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleGate capability="integrations.manage" variant="inline">
      <button type="button" style={primary} disabled={!allowed} onClick={() => setOpen(true)}>{t('openImport')}</button>
      <SlideOutPanel open={open} onClose={close} title={t('importTitle')}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('importIntro')}</p>
          <a href="https://agentskills.io" target="_blank" rel="noreferrer" style={{ fontSize: 'var(--font-size-small)', color: 'var(--coral-bright)' }}>{t('standardLink')}</a>
          <SkillFolderPicker onChange={(p) => { setPicked(p); setDone(null); setRefusal([]); }} />
          <SkillIssueList issues={refusal} />
          {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>{error}</p>}
          {done && <p role="status" style={{ margin: 0, color: 'var(--success)', fontSize: 'var(--font-size-small)' }}>{done}</p>}
          <div>
            <button type="button" style={{ ...primary, opacity: !picked || busy ? 0.6 : 1 }} disabled={!picked || busy || !allowed} onClick={() => void submit()}>
              {busy ? t('importing') : t('import')}
            </button>
          </div>
        </div>
      </SlideOutPanel>
    </RoleGate>
  );
}
