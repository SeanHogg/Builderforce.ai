'use client';

import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CreationNodeData } from './types';
import { DocumentEditor } from './DocumentEditor';
import styles from './CreationCanvas.module.css';
import { importCanvasFile, type ImportTranslator } from '@/lib/canvasFileImport';
import {
  RESUME_TEMPLATES,
  activeResumeRevision,
  createResumeFamily,
  deriveResume,
  originalResumeRevision,
  promoteResumeToMaster,
  restoreResumeAsNew,
  resumeFamilyFromNode,
  resumeNodePatch,
  selectResumeRevision,
  updateActiveResume,
  type CanvasResumeFamily,
  type ResumeTemplateId,
} from '@/lib/canvasResume';

type ResumeView = 'edit' | 'preview' | 'compare';

function jsonResumeMarkdown(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const resume = value as Record<string, unknown>;
  const basics = resume.basics && typeof resume.basics === 'object' ? resume.basics as Record<string, unknown> : {};
  const lines: string[] = [];
  const name = typeof basics.name === 'string' ? basics.name.trim() : '';
  if (name) lines.push(`# ${name}`);
  const headline = [basics.label, basics.email, basics.phone, basics.url].filter((item): item is string => typeof item === 'string' && !!item.trim());
  if (headline.length) lines.push(headline.join(' · '));
  if (typeof basics.summary === 'string' && basics.summary.trim()) lines.push(`## Summary\n\n${basics.summary.trim()}`);
  const section = (key: string, heading: string, format: (row: Record<string, unknown>) => string) => {
    const rows = Array.isArray(resume[key]) ? resume[key] as unknown[] : [];
    const entries = rows.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item) ? [format(item as Record<string, unknown>)] : []).filter(Boolean);
    if (entries.length) lines.push(`## ${heading}\n\n${entries.join('\n\n')}`);
  };
  section('work', 'Experience', (row) => {
    const title = [row.position, row.name].filter((item): item is string => typeof item === 'string' && !!item.trim()).join(' — ');
    const dates = [row.startDate, row.endDate].filter((item): item is string => typeof item === 'string' && !!item.trim()).join(' – ');
    const highlights = Array.isArray(row.highlights) ? row.highlights.filter((item): item is string => typeof item === 'string').map((item) => `- ${item}`).join('\n') : '';
    return [`### ${title}`, dates, typeof row.summary === 'string' ? row.summary : '', highlights].filter(Boolean).join('\n\n');
  });
  section('education', 'Education', (row) => {
    const title = [row.studyType, row.area].filter((item): item is string => typeof item === 'string' && !!item.trim()).join(' in ');
    return `### ${title}${typeof row.institution === 'string' ? ` — ${row.institution}` : ''}`;
  });
  section('skills', 'Skills', (row) => {
    const keywords = Array.isArray(row.keywords) ? row.keywords.filter((item): item is string => typeof item === 'string').join(', ') : '';
    return `- **${typeof row.name === 'string' ? row.name : ''}**${keywords ? `: ${keywords}` : ''}`;
  });
  return lines.length ? lines.join('\n\n') : null;
}

export function CanvasResumeEditor({ data, onEdit }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void }) {
  const t = useTranslations('creationCanvas.resumeEditor');
  const tImport = useTranslations('creationCanvas.import');
  const translateImport = tImport as unknown as ImportTranslator;
  const family = resumeFamilyFromNode(data);
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ResumeView>('preview');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');

  const commit = (next: CanvasResumeFamily) => onEdit?.({
    ...resumeNodePatch(next),
    status: activeResumeRevision(next).kind === 'original' ? t('statusOriginal') : t('statusDerived'),
  });
  const importResume = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onEdit) return;
    setError('');
    try {
      let markdown: string | null = null;
      if (/\.json$/i.test(file.name)) markdown = jsonResumeMarkdown(JSON.parse(await file.text()));
      else {
        const imported = await importCanvasFile(file, translateImport);
        const first = imported.objects[0]?.data;
        const body = first?.markdown ?? first?.content;
        markdown = typeof body === 'string' && body.trim() ? body : null;
      }
      if (!markdown) { setError(t('importUnreadable')); return; }
      const title = file.name.replace(/\.[^.]+$/, '');
      onEdit({ ...resumeNodePatch(createResumeFamily({ title, markdown })), fileName: file.name, mimeType: file.type, fileSize: file.size, status: t('statusOriginal') });
      setView('preview');
    } catch {
      setError(t('importUnreadable'));
    }
  };

  if (!family) return <div className={`${styles.resumeEmpty} nodrag nowheel`} onPointerDownCapture={(event) => event.stopPropagation()}>
    <strong>{t('emptyTitle')}</strong>
    <p>{t('emptyBody')}</p>
    <input ref={input} type="file" hidden accept=".pdf,.doc,.docx,.rtf,.txt,.md,.markdown,.json" onChange={importResume} />
    <button type="button" disabled={!onEdit} onClick={() => input.current?.click()}>{t('upload')}</button>
    <small>{t('acceptedFormats')}</small>
    {error && <p role="alert" className={styles.resumeError}>{error}</p>}
  </div>;

  const active = activeResumeRevision(family);
  const original = originalResumeRevision(family);
  const template = RESUME_TEMPLATES.find((item) => item.id === active.templateId) ?? RESUME_TEMPLATES[0];
  const previewStyle = {
    '--resume-accent': template.accent,
    '--resume-paper': template.paper,
    '--resume-ink': template.ink,
  } as CSSProperties;
  const createVersion = () => {
    const next = deriveResume(family, newTitle || t('untitledVersion'), { fromRevisionId: family.originalRevisionId });
    setNewTitle('');
    setView('edit');
    commit(next);
  };

  return <div className={`${styles.resumeStudio} nodrag nowheel`} onPointerDownCapture={(event) => event.stopPropagation()}>
    <div className={styles.resumeSourceBar}>
      <label><span>{t('version')}</span><select value={active.id} onChange={(event) => commit(selectResumeRevision(family, event.target.value))}>
        {family.revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.kind === 'original' ? t('originalPrefix', { title: revision.title }) : revision.title}{revision.id === family.masterRevisionId ? ` · ${t('master')}` : ''}</option>)}
      </select></label>
      <span className={styles.resumeImmutable} data-original={active.kind === 'original' || undefined}>{active.kind === 'original' ? t('immutableOriginal') : t('editableVersion')}</span>
      <button type="button" disabled={!onEdit || active.id === family.masterRevisionId} onClick={() => commit(promoteResumeToMaster(family, active.id))}>{t('makeMaster')}</button>
    </div>
    <div className={styles.resumeVersionCreator}>
      <input value={newTitle} placeholder={t('versionNamePlaceholder')} aria-label={t('versionName')} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createVersion(); }} />
      <button type="button" disabled={!onEdit} onClick={createVersion}>{t('createFromOriginal')}</button>
      {active.kind === 'derived' && <button type="button" disabled={!onEdit} onClick={() => commit(restoreResumeAsNew(family, active.id, t('restoredVersion', { title: active.title })))}>{t('restoreAsNew')}</button>}
    </div>
    <div className={styles.resumeControls}>
      <div role="tablist" aria-label={t('viewMode')}>
        {(['edit', 'preview', 'compare'] as const).map((mode) => <button key={mode} type="button" role="tab" aria-selected={view === mode} disabled={mode === 'edit' && active.kind === 'original'} onClick={() => setView(mode)}>{t(mode)}</button>)}
      </div>
      <label><span>{t('template')}</span><select value={active.templateId} disabled={!onEdit || active.kind === 'original'} onChange={(event) => commit(updateActiveResume(family, { templateId: event.target.value as ResumeTemplateId }))}>
        {RESUME_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}
      </select></label>
    </div>
    {view === 'edit' && active.kind === 'derived' && <DocumentEditor markdown={active.markdown} label={t('editorLabel', { title: active.title })} onCommit={(markdown) => commit(updateActiveResume(family, { markdown }))} />}
    {view === 'preview' && <article className={styles.resumePaper} data-mode={template.mode} data-font={template.font} data-density={template.density} data-columns={template.columns} style={previewStyle}><ReactMarkdown remarkPlugins={[remarkGfm]}>{active.markdown}</ReactMarkdown></article>}
    {view === 'compare' && <div className={styles.resumeCompare}>
      <section><strong>{t('original')}</strong><article className={styles.resumePaper}><ReactMarkdown remarkPlugins={[remarkGfm]}>{original.markdown}</ReactMarkdown></article></section>
      <section><strong>{t('selectedVersion')}</strong><article className={styles.resumePaper} data-font={template.font} data-density={template.density} style={previewStyle}><ReactMarkdown remarkPlugins={[remarkGfm]}>{active.markdown}</ReactMarkdown></article></section>
    </div>}
  </div>;
}
