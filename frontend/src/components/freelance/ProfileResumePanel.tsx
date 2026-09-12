'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Surface } from '@/components/ui';
import { Select } from '@/components/Select';
import { ResumeDocumentView } from '@/components/resume/ResumeDocumentView';
import { RESUME_TEMPLATES, masterResumeRevision, type ResumeTemplateId } from '@/lib/canvasResume';
import { getMyResume, updateMyResume, uploadMyResume, getResumeSuggestions, type MyResume, type ResumePrivacyLevel, type ResumeSuggestions } from '@/lib/freelance/talentProfile';
import { faultMessage } from '@/lib/apiClient';
import { usePanelTask } from '@/hooks/usePanelTask';
/** Who may see the résumé. Ordered widest → narrowest, which is how the label reads. */
const PRIVACY_LEVELS: readonly ResumePrivacyLevel[] = ['public', 'recruiter_only', 'connections', 'private'];

/**
 * The résumé, on the person's own profile — upload it, choose how it looks, pick which
 * version is the one employers see, and decide who that is.
 *
 * ── WHY THIS OWNS ITS OWN STATE ──────────────────────────────────────────────────
 * The résumé is a different object from the profile row, saved by different endpoints
 * on a different cadence: changing a template must not require pressing "Save profile",
 * and editing a headline must not silently republish a résumé. Keeping it self-contained
 * is what keeps those two save semantics from leaking into each other. The parent only
 * hears about the one thing it genuinely needs — the extracted fields it can prefill.
 */
export function ProfileResumePanel({ onAutofill, onLoaded }: {
  onAutofill?: (suggestions: ResumeSuggestions) => void;
  /** Reports the loaded résumé up so the profile Preview can show it beside unsaved edits. */
  onLoaded?: (resume: MyResume | null) => void;
}) {
  const t = useTranslations('freelancer.resume');
  // Template names already exist for the canvas editor; a second copy of twelve labels
  // in five catalogues is exactly the duplication that drifts.
  const tTemplate = useTranslations('creationCanvas.resumeEditor');
  const [resume, setResume] = useState<MyResume | null>(null);
  const [loading, setLoading] = useState(true);
  const { busy, error, notice, run: runTask, fail: failTask } = usePanelTask();
  // Which action the in-flight task is — only so the right control says "…ing".
  const [pending, setPending] = useState<'upload' | 'autofill' | 'patch' | null>(null);
  const uploading = busy && pending === 'upload';
  const autofilling = busy && pending === 'autofill';

  /** Read the résumé and report it up — the mount load and the post-upload re-read. */
  const fetchResume = useCallback(async () => {
    const loaded = await getMyResume();
    setResume(loaded);
    onLoaded?.(loaded);
    return loaded;
  }, [onLoaded]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await fetchResume();
    } catch (err) {
      const message = faultMessage(err, t('loadFailed'));
      if (message) failTask(message);
    } finally {
      setLoading(false);
    }
  }, [t, fetchResume, failTask]);

  useEffect(() => { void load(); }, [load]);

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPending('upload');
    const result = await runTask(() => uploadMyResume(file), { failure: t('uploadFailed') });
    // The title comes from the UPLOAD; the notice rides on the re-read, so it never
    // sits above the résumé it replaced.
    if (result !== undefined) {
      await runTask(fetchResume, { success: t('uploaded', { title: result.resumeTitle }), failure: t('loadFailed') });
    }
    // Let the same file be chosen again after a failure.
    event.target.value = '';
  };

  /** Persist one résumé setting, showing the result optimistically. */
  const patch = async (input: { templateId?: ResumeTemplateId; privacy?: ResumePrivacyLevel; masterRevisionId?: string }) => {
    if (!resume) return;
    setPending('patch');
    const updated = await runTask(() => updateMyResume(input), { failure: t('updateFailed') });
    if (updated === undefined) return;
    const next = { ...resume, family: updated.family };
    setResume(next);
    onLoaded?.(next);
  };

  const applyToProfile = async () => {
    setPending('autofill');
    const suggestions = await runTask(async () => {
      const found = await getResumeSuggestions();
      if (!found.available) throw new Error(t('autofillUnavailable'));
      return found;
    }, { success: t('autofilled'), failure: t('autofillFailed') });
    if (suggestions === undefined) return;
    onAutofill?.(suggestions);
  };

  const master = resume ? masterResumeRevision(resume.family) : null;
  const activeTemplate = master?.templateId ?? resume?.family.defaultTemplateId ?? null;

  return (
    <Surface style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' }}>{t('title')}</h2>
        <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('subtitle')}</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <label className="ui-button ui-button--secondary ui-button--sm" style={{ cursor: uploading ? 'progress' : 'pointer' }}>
          {uploading ? t('uploading') : (resume ? t('replace') : t('upload'))}
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md,.json"
            onChange={onUpload}
            disabled={busy}
            style={{ display: 'none' }}
          />
        </label>
        {resume && (
          <Button variant="secondary" size="sm" onClick={applyToProfile} disabled={busy}>
            {autofilling ? t('filling') : t('fillFromResume')}
          </Button>
        )}
      </div>

      {loading && <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>{t('loading')}</p>}
      {notice && <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--success-text)', margin: 0 }}>{notice}</p>}
      {error && <p role="alert" style={{ fontSize: 'var(--font-size-small)', color: 'var(--error-text)', margin: 0 }}>{error}</p>}

      {!loading && !resume && (
        <div style={{
          padding: 20, borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-subtle)',
          background: 'var(--bg-elevated)', fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', textAlign: 'center',
        }}>
          {t('empty')}
        </div>
      )}

      {resume && master && (
        <>
          {/* The controls that decide what an employer actually sees. Each saves on
              change — there is no second "save résumé" step to forget. */}
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {t('styleLabel')}
              <Select
                value={master.templateId}
                onChange={(event) => void patch({ templateId: event.target.value as ResumeTemplateId })}
              >
                {RESUME_TEMPLATES.map((template) => (
                  <option
                    key={template.id}
                    value={template.id}
                    // A native <option> needs its own opaque colours or it is unreadable
                    // in one of the two themes.
                    style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
                  >
                    {tTemplate(template.labelKey)}
                  </option>
                ))}
              </Select>
            </label>

            <label style={{ display: 'grid', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
              {t('privacyLabel')}
              <Select
                value={resume.family.privacy === 'draft' ? 'private' : resume.family.privacy}
                onChange={(event) => void patch({ privacy: event.target.value as ResumePrivacyLevel })}
              >
                {PRIVACY_LEVELS.map((level) => (
                  <option key={level} value={level} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                    {tTemplate(`privacy_${level}`)}
                  </option>
                ))}
              </Select>
            </label>

            {/* Only meaningful once there is more than one version to choose between. */}
            {resume.family.revisions.length > 1 && (
              <label style={{ display: 'grid', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                {t('versionLabel')}
                <Select
                  value={resume.family.masterRevisionId}
                  onChange={(event) => void patch({ masterRevisionId: event.target.value })}
                >
                  {resume.family.revisions.map((revision) => (
                    <option key={revision.id} value={revision.id} style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}>
                      {revision.title}{revision.kind === 'original' ? ` — ${t('versionOriginal')}` : ''}
                    </option>
                  ))}
                </Select>
              </label>
            )}
          </div>

          <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: 0 }}>
            {t('versionCount', { count: resume.family.revisions.length })}
          </p>

          {/* The résumé itself — the same renderer an employer's browser runs. */}
          <ResumeDocumentView family={resume.family} templateId={activeTemplate ?? undefined} />
        </>
      )}
    </Surface>
  );
}
