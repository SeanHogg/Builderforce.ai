'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import { DocumentEditor } from './DocumentEditor';
import { ResumeStructuredEditor } from './ResumeStructuredEditor';
import styles from './CreationCanvas.module.css';
import { importCanvasFile, type ImportTranslator } from '@/lib/canvasFileImport';
import {
  RESUME_TEMPLATES,
  activeResumeRevision,
  createResumeFamily,
  deriveResume,
  originalResumeRevision,
  promoteResumeToMaster,
  renderResumeMarkdown,
  resumeDocumentFromJson,
  resumeDocumentFromMarkdown,
  restoreResumeAsNew,
  resumeFamilyFromNode,
  resumeNodePatch,
  selectResumeRevision,
  updateActiveResume,
  type CanvasResumeFamily,
  type CanvasResumeDocument,
  type ResumeTemplateId,
} from '@/lib/canvasResume';
import { RESUME_DOCUMENT_STYLES, renderCanvasResumeRevision } from '@/lib/canvasResumeRenderer';

type ResumeView = 'edit' | 'preview' | 'compare';

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
      let document: CanvasResumeDocument | null = null;
      if (/\.json$/i.test(file.name)) {
        document = resumeDocumentFromJson(JSON.parse(await file.text()));
        markdown = document ? renderResumeMarkdown(document) : null;
      } else {
        const imported = await importCanvasFile(file, translateImport);
        const first = imported.objects[0]?.data;
        const body = first?.markdown ?? first?.content;
        markdown = typeof body === 'string' && body.trim() ? body : null;
        if (markdown) document = resumeDocumentFromMarkdown(markdown);
      }
      if (!markdown) { setError(t('importUnreadable')); return; }
      const embeddedName = typeof document?.basics?.name === 'string' ? document.basics.name.trim() : '';
      const title = embeddedName || file.name.replace(/\.[^.]+$/, '');
      onEdit({ ...resumeNodePatch(createResumeFamily({ title, markdown, ...(document ? { document } : {}) })), fileName: file.name, mimeType: file.type, fileSize: file.size, status: t('statusOriginal') });
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
  const rendered = renderCanvasResumeRevision(active);
  const originalRendered = renderCanvasResumeRevision(original);
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
    {view === 'edit' && active.kind === 'derived' && <div className={styles.resumeEditStack}>
      {active.document && <ResumeStructuredEditor document={active.document} onChange={(document) => commit(updateActiveResume(family, { document }))} />}
      <details className={styles.resumeRawEditor} open={!active.document}><summary>{t('rawTextEditor')}</summary><DocumentEditor markdown={active.markdown} label={t('editorLabel', { title: active.title })} onCommit={(markdown) => commit(updateActiveResume(family, { markdown, structuredStale: !!active.document }))} /></details>
      {active.structuredStale && <p role="status" className={styles.resumeStaleWarning}>{t('structuredStale')}</p>}
    </div>}
    {view === 'preview' && <div className={styles.resumePreviewViewport}><style>{RESUME_DOCUMENT_STYLES}</style><div dangerouslySetInnerHTML={{ __html: rendered.html }} /></div>}
    {view === 'compare' && <div className={styles.resumeCompare}>
      <style>{RESUME_DOCUMENT_STYLES}</style>
      <section><strong>{t('original')}</strong><div className={styles.resumeCompareViewport} dangerouslySetInnerHTML={{ __html: originalRendered.html }} /></section>
      <section><strong>{t('selectedVersion')}</strong><div className={styles.resumeCompareViewport} dangerouslySetInnerHTML={{ __html: rendered.html }} /></section>
    </div>}
  </div>;
}
