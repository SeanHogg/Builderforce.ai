/**
 * "New skill" — write an Agent Skill in the browser.
 *
 * What a person writes here IS a SKILL.md: a title, the spec `name` it is loaded by,
 * the `description` an agent matches a task against, and the instructions. It is
 * serialised with `@builderforce/agent-skills` and sent through the SAME import path a
 * folder from disk takes, so a skill written here and a skill imported from Claude Code
 * are the same object, exportable the same way. It used to be a record in this
 * browser's localStorage that no agent ever read.
 *
 * Self-contained: it owns its trigger, its panel, its entitlement (manager-level —
 * saving signs the skill off) and its call; the host hears only `onCreated`.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { serializeSkillMarkdown, toSkillName, validateSkillFrontmatter, SKILL_FILE } from '@builderforce/agent-skills';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { RoleGate } from '@/components/RoleGate';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { ApiRequestError } from '@/lib/apiClient';
import { SkillFolderRejected, workspaceSkillsApi } from '@/lib/workspaceSkillsApi';
import { SkillIssueList } from './SkillFolderPicker';
import type { SkillIssue } from '@builderforce/agent-skills';

const EMPTY = { title: '', name: '', description: '', instructions: '', license: '' };

export function WorkspaceSkillAuthor({ onCreated }: { onCreated?: () => void }) {
  const t = useTranslations('skillFolder');
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<SkillIssue[]>([]);

  const name = nameTouched ? form.name : toSkillName(form.title);
  // The verdict the server will reach, shown while typing.
  const check = useMemo(() => validateSkillFrontmatter({
    name,
    description: form.description,
    ...(form.license.trim() ? { license: form.license.trim() } : {}),
  }), [name, form.description, form.license]);
  const ready = check.manifest != null && form.instructions.trim().length > 0;

  const close = () => {
    setOpen(false);
    setForm(EMPTY);
    setNameTouched(false);
    setError(null);
    setRefusal([]);
  };

  const save = async () => {
    if (!check.manifest) return;
    setBusy(true);
    setError(null);
    setRefusal([]);
    try {
      const manifest = form.title.trim() && form.title.trim() !== name
        ? { ...check.manifest, metadata: { ...(check.manifest.metadata ?? {}), title: form.title.trim() } }
        : check.manifest;
      // 'create': a new skill must not silently replace an existing one of the same name.
      await workspaceSkillsApi.importFolder([{ path: SKILL_FILE, content: serializeSkillMarkdown(manifest, form.instructions) }], null, 'create');
      onCreated?.();
      close();
    } catch (e) {
      if (e instanceof SkillFolderRejected) setRefusal(e.issues);
      else if (e instanceof ApiRequestError && e.status === 409) setError(t('nameTaken', { name }));
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleGate capability="integrations.manage" variant="inline">
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>{t('newSkill')}</button>
      <SlideOutPanel open={open} onClose={close} title={t('newSkillTitle')} width="sheet" widthStorageKey="skills-new">
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('newSkillIntro')}</p>
          <div>
            <label className="label" htmlFor="skill-title">{t('fieldTitle')}</label>
            <input id="skill-title" className="input" placeholder={t('fieldTitlePlaceholder')} value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="skill-name">{t('fieldName')}</label>
            <input id="skill-name" className="input" style={{ fontFamily: 'var(--font-mono)' }} placeholder="ship-a-schema-change" value={name}
              onChange={(e) => { setNameTouched(true); setForm((f) => ({ ...f, name: e.target.value })); }} />
            <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('fieldNameHint')}</p>
          </div>
          <div>
            <label className="label" htmlFor="skill-description">{t('fieldDescription')}</label>
            <textarea id="skill-description" className="input" rows={3} placeholder={t('fieldDescriptionPlaceholder')} value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="skill-instructions">{t('fieldInstructions')}</label>
            <textarea id="skill-instructions" className="input" rows={12} style={{ fontFamily: 'var(--font-mono)' }} placeholder={t('fieldInstructionsPlaceholder')} value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} />
          </div>
          <div>
            <label className="label" htmlFor="skill-license">{t('fieldLicense')}</label>
            <input id="skill-license" className="input" placeholder="MIT" value={form.license}
              onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))} />
          </div>
          {(form.title || form.description) && <SkillIssueList issues={check.issues} />}
          <SkillIssueList issues={refusal} />
          {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--font-size-small)' }}>{error}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={close}>{t('cancel')}</button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!ready || busy}>{busy ? t('saving') : t('save')}</button>
          </div>
        </div>
      </SlideOutPanel>
    </RoleGate>
  );
}
