/**
 * Pick an Agent Skills folder — a directory, a .zip of one, or a lone SKILL.md — and
 * see, before anything is sent, whether it is a valid skill.
 *
 * The verdict comes from `@builderforce/agent-skills`, the same package the server
 * validates with, so "looks fine here" and "accepted there" cannot disagree. The
 * component owns the reading and the preview; what to DO with a valid folder (import
 * it, publish it) is the caller's, handed over through `onChange`.
 */

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { readSkillPackage, writeSkillPackage, type SkillFile, type SkillIssue, type SkillPackage } from '@builderforce/agent-skills';
import { readPickedSkillFolder } from '@/lib/skillFolderFiles';

export interface PickedSkill {
  /**
   * The folder as the server will store it — normalised by `readSkillPackage` (hidden
   * files, `.git`, files outside the skill dropped), so the request is the one the
   * preview approved, never the raw pick the server's limits would refuse.
   */
  files: SkillFile[];
  pkg: SkillPackage;
}

const button: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 12px',
  minHeight: 36,
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  cursor: 'pointer',
};

/** Spec issues, errors first — shared by the picker's preview and a server refusal. */
export function SkillIssueList({ issues }: { issues: readonly SkillIssue[] }) {
  const t = useTranslations('skillFolder');
  // The package's `message` is English; a known `code` reads in the viewer's language.
  // Per-field codes (`license_type`, `name_coerced`) share one generic key each.
  const text = (i: SkillIssue) => {
    const key = t.has(`issue.${i.code}`) ? i.code : /_coerced$/.test(i.code) ? 'coerced' : /_type$/.test(i.code) ? 'type' : null;
    return key ? t(`issue.${key}`, { field: i.field }) : i.message;
  };
  if (issues.length === 0) return null;
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const list = (items: SkillIssue[], color: string) => (
    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 'var(--font-size-small)', color }}>
      {items.map((i, n) => <li key={`${i.code}-${n}`}><code>{i.field}</code> — {text(i)}</li>)}
    </ul>
  );
  return (
    <div role={errors.length ? 'alert' : undefined} style={{ marginTop: 10 }}>
      {errors.length > 0 && (<><strong style={{ fontSize: 'var(--font-size-small)', color: 'var(--danger)' }}>{t('issuesHeading')}</strong>{list(errors, 'var(--danger)')}</>)}
      {warnings.length > 0 && (<><strong style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('warningsHeading')}</strong>{list(warnings, 'var(--text-secondary)')}</>)}
    </div>
  );
}

export function SkillFolderPicker({ onChange }: { onChange: (picked: PickedSkill | null) => void }) {
  const t = useTranslations('skillFolder');
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<{ pkg: SkillPackage | null; issues: SkillIssue[] } | null>(null);

  const read = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setReading(true);
    try {
      const result = readSkillPackage(await readPickedSkillFolder(list));
      setPreview({ pkg: result.package, issues: result.issues });
      onChange(result.package ? { files: writeSkillPackage(result.package), pkg: result.package } : null);
    } finally {
      setReading(false);
      if (folderInput.current) folderInput.current.value = '';
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={button} disabled={reading} onClick={() => folderInput.current?.click()}>{t('chooseFolder')}</button>
        <button type="button" style={button} disabled={reading} onClick={() => fileInput.current?.click()}>{t('chooseFile')}</button>
        {preview && (
          <button type="button" style={{ ...button, color: 'var(--text-secondary)' }} onClick={() => { setPreview(null); onChange(null); }}>{t('clear')}</button>
        )}
      </div>
      {/* `webkitdirectory` is the directory picker every current browser implements. */}
      <input
        ref={folderInput}
        type="file"
        hidden
        multiple
        aria-label={t('chooseFolder')}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => void read(e.target.files)}
      />
      <input ref={fileInput} type="file" hidden accept=".zip,.md,application/zip,text/markdown" aria-label={t('chooseFile')} onChange={(e) => void read(e.target.files)} />

      {reading && <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', margin: '8px 0 0' }}>{t('reading')}</p>}
      {preview?.pkg && (
        <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--bg-deep)' }}>
          <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{preview.pkg.manifest.name}</strong>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{preview.pkg.manifest.description}</p>
          <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>
            {t('fileCount', { count: preview.pkg.files.length + 1 })}
          </p>
        </div>
      )}
      {preview && <SkillIssueList issues={preview.issues} />}
    </div>
  );
}
