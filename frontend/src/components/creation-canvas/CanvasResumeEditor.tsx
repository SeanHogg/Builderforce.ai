'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { CreationNodeData } from './types';
import { DocumentEditor } from './DocumentEditor';
import { ResumeStructuredEditor } from './ResumeStructuredEditor';
import styles from './CreationCanvas.module.css';
import { importCanvasFile, type ImportTranslator } from '@/lib/canvasFileImport';
import { importResumeSource } from '@/lib/resumeImportApi';
import {
  RESUME_TEMPLATES,
  activeResumeRevision,
  createResumeFamily,
  deleteResumeRevision,
  detachResumeRevision,
  deriveResume,
  isJsonResume,
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
  updateActiveResumePresentation,
  updateResumeFamilySettings,
  type CanvasResumeFamily,
  type CanvasResumeDocument,
  type ResumeTemplateId,
  type ResumeOrientation,
  type ResumePageSize,
} from '@/lib/canvasResume';
import { RESUME_DOCUMENT_STYLES, renderCanvasResumeRevision, resumePageDimensions } from '@/lib/canvasResumeRenderer';
import { compareResumeDocuments, mergeResumeAsNewVersion, type ResumeDiffSection } from '@/lib/canvasResumeDiff';
import { analyzeResumeAgainstJob, resumeFieldRewritePrompt, resumeTailorPrompt, type ResumeAiField } from '@/lib/canvasResumeAts';
import { applyResumeBulletConsolidation, suggestResumeBulletConsolidation } from '@/lib/canvasResumeConsolidate';
import type { CanvasResumeShare } from '@/lib/builderforceApi';

type ResumeView = 'edit' | 'preview' | 'compare';
type ImportStage = 'review' | 'uploading' | 'extracting' | 'ocr' | 'structuring' | 'ready';
type PendingLifecycleAction = { kind: 'promote' | 'delete'; revisionId: string } | null;

const RESUME_STYLE_ELEMENT_ID = 'canvas-resume-document-styles';
let mountedResumeEditors = 0;

/**
 * The résumé document stylesheet, mounted ONCE for the whole page.
 *
 * It used to be an inline `<style>` beside every rendering: one in the preview, one in
 * the compare pane, and one per template thumbnail — thirteen copies of the same four
 * kilobytes inside a single open editor, multiplied again by every résumé card on the
 * board. Each copy is a stylesheet the browser parses and re-matches against the
 * document on mount, and that cost lands exactly when the board is busiest: right after
 * a template fan-out drops ten résumés onto it.
 *
 * The rules are global class selectors, so one copy styles every résumé on the page.
 * Reference-counted rather than mounted-and-left, so a board with no résumé on it does
 * not carry résumé CSS.
 */
function ResumeDocumentStyles() {
  useEffect(() => {
    mountedResumeEditors += 1;
    if (!document.getElementById(RESUME_STYLE_ELEMENT_ID)) {
      const element = document.createElement('style');
      element.id = RESUME_STYLE_ELEMENT_ID;
      element.textContent = RESUME_DOCUMENT_STYLES;
      document.head.append(element);
    }
    return () => {
      mountedResumeEditors -= 1;
      if (mountedResumeEditors <= 0) document.getElementById(RESUME_STYLE_ELEMENT_ID)?.remove();
    };
  }, []);
  return null;
}

function ImportReview({ file, stage, onImport, onCancel }: { file: File; stage: ImportStage; onImport: () => void; onCancel: () => void }) {
  const t = useTranslations('creationCanvas.resumeEditor');
  const busy = stage !== 'review' && stage !== 'ready';
  const progress = stage === 'uploading' ? 25 : stage === 'extracting' ? 50 : stage === 'ocr' || stage === 'structuring' ? 80 : stage === 'ready' ? 100 : 0;
  const extension = file.name.split('.').pop()?.toUpperCase() || t('fileTypeUnknown');
  return <section className={styles.resumeImportReview} aria-live="polite">
    <span className={styles.resumeFileIcon} aria-hidden>{extension.slice(0, 4)}</span>
    <div><strong>{file.name}</strong><small>{extension} · {Math.max(1, Math.ceil(file.size / 1024)).toLocaleString()} KB</small>
      {busy && <><progress max="100" value={progress} /><small>{t(`importStage_${stage}`)}</small></>}
    </div>
    <div><button type="button" disabled={busy} onClick={onImport}>{t('confirmImport')}</button><button type="button" disabled={busy} onClick={onCancel}>{t('cancelImport')}</button></div>
  </section>;
}

function ResumePreview({ html, page, zoom, mode, onClose }: { html: string; page: { width: number; height: number }; zoom: number; mode: CanvasResumeFamily['previewMode']; onClose: () => void }) {
  const t = useTranslations('creationCanvas.resumeEditor');
  const documentRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState(1);
  useEffect(() => {
    const element = documentRef.current;
    if (!element) return;
    const calculate = () => setPageCount(Math.max(1, Math.ceil(element.scrollHeight / (page.height * 96 / 25.4))));
    calculate();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(calculate); observer.observe(element);
    return () => observer.disconnect();
  }, [html, page.height]);
  return <div className={styles.resumePreviewShell}><button type="button" className={styles.resumePreviewClose} onClick={onClose} aria-label={t('closePreview')}>×</button><div className={styles.resumePreviewViewport} data-page-view={mode}><div className={styles.resumePreviewCanvas} style={{ width: `${page.width * zoom / 100}mm`, minHeight: `${page.height * pageCount * zoom / 100}mm`, '--resume-page-height': `${page.height * zoom / 100}mm` } as CSSProperties}><div ref={documentRef} style={{ width: `${page.width}mm`, minHeight: `${page.height}mm`, transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }} dangerouslySetInnerHTML={{ __html: html }} />{mode !== 'continuous' && Array.from({ length: pageCount }, (_, index) => <span key={index} className={styles.resumePageNumber} style={{ top: `calc(var(--resume-page-height) * ${index + 1} - 22px)` }}>{t('pageNumber', { page: index + 1, count: pageCount })}</span>)}</div></div></div>;
}

type ResumeShareActions = { create: (kind: 'view' | 'embed') => Promise<void>; list: () => Promise<CanvasResumeShare[]>; revoke: (shareId: string) => Promise<void> };

/** A picked `.json` that is already a résumé, in the shape the server extractor returns
 *  — so the caller has one code path whether the document was parsed here or there. */
function localJsonResume(source: string): { document: unknown; sourceFileKey: string | null } | null {
  try {
    const parsed = JSON.parse(source.replace(/^﻿/, '')) as unknown;
    return isJsonResume(parsed) ? { document: parsed, sourceFileKey: null } : null;
  } catch { return null; }
}

export function CanvasResumeEditor({ data, onEdit, onTailor, onDetach, shareActions }: { data: CreationNodeData; onEdit?: (patch: Partial<CreationNodeData>) => void; onTailor?: (prompt: string) => void; onDetach?: (data: Partial<CreationNodeData>) => void; shareActions?: ResumeShareActions }) {
  const t = useTranslations('creationCanvas.resumeEditor');
  const tImport = useTranslations('creationCanvas.import');
  const translateImport = tImport as unknown as ImportTranslator;
  /**
   * EVERY DERIVATION BELOW IS MEMOISED, AND THAT IS LOAD-BEARING.
   *
   * Rendering a résumé is not cheap — deep-clone the document, project it to Markdown,
   * convert to HTML, split it into sections and re-order them per template — and this
   * component used to do it twice per React render, plus once per template thumbnail,
   * plus a full ATS analysis, a structural diff and a duplicate-bullet scan. None of
   * that depends on the state that actually changes: typing one character into the job
   * description, or nudging the zoom slider, re-rendered both documents and all twelve
   * gallery thumbnails. On a board holding several résumé cards that is the difference
   * between a slider that drags and one that stutters.
   *
   * `family` is memoised first because everything else keys off its identity — it is
   * rebuilt by a validating parse, so recomputing it per render made every downstream
   * memo (and the Escape-key effect below) miss on every render regardless.
   */
  const family = useMemo(() => resumeFamilyFromNode(data), [data.resumeFamily]);
  const input = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ResumeView>('preview');
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState('');
  const [mergeSections, setMergeSections] = useState<ResumeDiffSection[]>([]);
  const [jobDescription, setJobDescription] = useState('');
  const [aiField, setAiField] = useState<ResumeAiField>('basics.summary');
  const [aiDirection, setAiDirection] = useState('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [sharesOpen, setSharesOpen] = useState(false);
  const [shares, setShares] = useState<CanvasResumeShare[]>([]);
  const [sharing, setSharing] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importStage, setImportStage] = useState<ImportStage>('review');
  const [excludedBulletSuggestions, setExcludedBulletSuggestions] = useState<string[]>([]);
  const [pendingLifecycleAction, setPendingLifecycleAction] = useState<PendingLifecycleAction>(null);

  useEffect(() => {
    if (!sharesOpen || !shareActions) return;
    let live = true;
    shareActions.list().then((rows) => { if (live) setShares(rows); }).catch(() => {});
    return () => { live = false; };
  }, [shareActions, sharesOpen]);

  useEffect(() => {
    if (view !== 'preview') return;
    const closePreview = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const current = family ? activeResumeRevision(family) : null;
      setView(current?.kind === 'derived' ? 'edit' : 'compare');
    };
    window.addEventListener('keydown', closePreview);
    return () => window.removeEventListener('keydown', closePreview);
  }, [family, view]);

  const active = useMemo(() => family ? activeResumeRevision(family) : null, [family]);
  const original = useMemo(() => family ? originalResumeRevision(family) : null, [family]);
  const rendered = useMemo(() => active ? renderCanvasResumeRevision(active) : null, [active]);
  const originalRendered = useMemo(() => original ? renderCanvasResumeRevision(original) : null, [original]);
  const differences = useMemo(() => original?.document && active?.document
    ? compareResumeDocuments(original.document, active.document).filter((difference) => difference.changed)
    : [], [active, original]);
  const ats = useMemo(() => active?.document && jobDescription.trim()
    ? analyzeResumeAgainstJob(active.document, jobDescription)
    : null, [active, jobDescription]);
  const bulletSuggestions = useMemo(() => active?.document ? suggestResumeBulletConsolidation(active.document) : [], [active]);
  // Twelve full résumé renders. Gated on `galleryOpen` as well as memoised, so a closed
  // gallery costs nothing at all rather than costing twelve renders nobody can see.
  const thumbnails = useMemo(() => galleryOpen && active
    ? RESUME_TEMPLATES.map((item) => ({ item, html: renderCanvasResumeRevision({ ...active, templateId: item.id }).html }))
    : [], [active, galleryOpen]);

  const commit = (next: CanvasResumeFamily) => onEdit?.({
    ...resumeNodePatch(next),
    status: activeResumeRevision(next).kind === 'original' ? t('statusOriginal') : t('statusDerived'),
  });
  const chooseResume = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onEdit) return;
    setPendingFile(file);
    setImportStage('review');
    setError('');
  };
  const importResume = async () => {
    const file = pendingFile;
    if (!file || !onEdit) return;
    try {
      setImportStage('uploading');
      let extractedText = '';
      if (!/\.(png|jpe?g|webp|doc|json)$/i.test(file.name)) {
        setImportStage('extracting');
        const imported = await importCanvasFile(file, translateImport);
        const first = imported.objects[0]?.data;
        const body = first?.markdown ?? first?.content;
        extractedText = typeof body === 'string' ? body.trim() : '';
      }
      const needsOcr = !extractedText && /\.(pdf|doc|docx|png|jpe?g|webp)$/i.test(file.name);
      setImportStage(needsOcr ? 'ocr' : 'structuring');
      // A JSON Resume needs no server: it is ALREADY the structured document the
      // extractor exists to recover. Uploading it to have it handed back was a round-trip
      // that could fail — and it made this path behave differently from a drop on the
      // board, which now reads the same file locally and instantly.
      const local = /\.json$/i.test(file.name) ? localJsonResume(await file.text()) : null;
      const parsed = local ?? await importResumeSource(file, extractedText);
      const document = resumeDocumentFromJson(parsed.document);
      const markdown = document ? renderResumeMarkdown(document) : '';
      if (!document || !markdown.trim()) throw new Error('invalid structured resume');
      const embeddedName = typeof document?.basics?.name === 'string' ? document.basics.name.trim() : '';
      const title = embeddedName || file.name.replace(/\.[^.]+$/, '');
      const sourceFile = { key: parsed.sourceFileKey, name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size };
      if (family) {
        let next = deriveResume(family, t('importedVersion', { title }), { fromRevisionId: family.activeRevisionId });
        next = updateActiveResume(next, document ? { document } : { markdown, structuredStale: !!activeResumeRevision(next).document });
        next = { ...next, revisions: next.revisions.map((revision) => revision.id === next.activeRevisionId ? { ...revision, sourceFile } : revision) };
        onEdit({ ...resumeNodePatch(next), fileName: file.name, mimeType: file.type, fileSize: file.size, status: t('statusDerived') });
      } else {
        onEdit({ ...resumeNodePatch(createResumeFamily({ title, markdown, document, sourceFile })), fileName: file.name, mimeType: file.type, fileSize: file.size, status: t('statusOriginal') });
      }
      setImportStage('ready');
      setPendingFile(null);
      setView('preview');
    } catch {
      const errorKey = /\.pdf$/i.test(file.name) ? 'importErrorPdf'
        : /\.docx?$/i.test(file.name) ? 'importErrorWord'
          : /\.(png|jpe?g|webp)$/i.test(file.name) ? 'importErrorScan'
            : /\.json$/i.test(file.name) ? 'importErrorJson' : 'importUnreadable';
      setError(t(errorKey));
      setImportStage('review');
    }
  };

  if (!family || !active || !original || !rendered || !originalRendered) return <div className={`${styles.resumeEmpty} nodrag nowheel`} onPointerDownCapture={(event) => event.stopPropagation()}>
    <strong>{t('emptyTitle')}</strong>
    <p>{t('emptyBody')}</p>
    <input ref={input} type="file" hidden accept=".pdf,.doc,.docx,.rtf,.txt,.md,.markdown,.json,.png,.jpg,.jpeg,.webp" onChange={chooseResume} />
    <button type="button" disabled={!onEdit} onClick={() => input.current?.click()}>{t('upload')}</button>
    <small>{t('acceptedFormats')}</small>
    {pendingFile && <ImportReview file={pendingFile} stage={importStage} onImport={() => void importResume()} onCancel={() => setPendingFile(null)} />}
    {error && <p role="alert" className={styles.resumeError}>{error}</p>}
  </div>;

  const selectedBulletSuggestions = bulletSuggestions.filter((suggestion) => !excludedBulletSuggestions.includes(suggestion.id));
  const page = resumePageDimensions(active.pageSize, active.orientation);
  const changePresentation = (patch: Parameters<typeof updateActiveResumePresentation>[1]) => commit(updateActiveResumePresentation(family, patch));
  const createVersion = () => {
    const next = deriveResume(family, newTitle || t('untitledVersion'), { fromRevisionId: family.originalRevisionId });
    setNewTitle('');
    setView('edit');
    commit(next);
  };

  return <div className={`${styles.resumeStudio} nodrag nowheel`} onPointerDownCapture={(event) => event.stopPropagation()}>
    <ResumeDocumentStyles />
    <input ref={input} type="file" hidden accept=".pdf,.doc,.docx,.rtf,.txt,.md,.markdown,.json,.png,.jpg,.jpeg,.webp" onChange={chooseResume} />
    <div className={styles.resumeSourceBar}>
      <label><span>{t('version')}</span><select value={active.id} onChange={(event) => commit(selectResumeRevision(family, event.target.value))}>
        {family.revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.kind === 'original' ? t('originalPrefix', { title: revision.title }) : revision.title}{revision.id === family.masterRevisionId ? ` · ${t('master')}` : ''}</option>)}
      </select></label>
      <span className={styles.resumeImmutable} data-original={active.kind === 'original' || undefined}>{active.kind === 'original' ? t('immutableOriginal') : t('editableVersion')}</span>
      <button type="button" disabled={!onEdit || active.id === family.masterRevisionId} onClick={() => setPendingLifecycleAction({ kind: 'promote', revisionId: active.id })}>{t('makeMaster')}</button>
      <label><span>{t('privacy')}</span><select value={family.privacy} disabled={!onEdit} onChange={(event) => commit(updateResumeFamilySettings(family, { privacy: event.target.value as CanvasResumeFamily['privacy'] }))}>
        {(['private', 'recruiter_only', 'connections', 'public', 'draft'] as const).map((privacy) => <option key={privacy} value={privacy}>{t(`privacy_${privacy}`)}</option>)}
      </select></label>
      <button type="button" disabled={!onEdit} onClick={() => commit(updateResumeFamilySettings(family, { archivedAt: family.archivedAt ? null : new Date().toISOString() }))}>{family.archivedAt ? t('unarchive') : t('archive')}</button>
      <button type="button" disabled={!onEdit} aria-pressed={family.watched} onClick={() => commit(updateResumeFamilySettings(family, { watched: !family.watched }))}>{family.watched ? t('unwatch') : t('watch')}</button>
      <button type="button" disabled={!shareActions || family.privacy !== 'public'} aria-expanded={sharesOpen} onClick={() => setSharesOpen((open) => !open)}>{t('shareResume')}</button>
    </div>
    {pendingFile && <ImportReview file={pendingFile} stage={importStage} onImport={() => void importResume()} onCancel={() => setPendingFile(null)} />}
    {sharesOpen && <section className={styles.resumeSharePanel}>
      <p>{t('sharePublicOnly')}</p>
      <div><button type="button" disabled={sharing} onClick={() => { setSharing(true); void shareActions?.create('view').finally(() => setSharing(false)); }}>{t('copyPublicLink')}</button>
      <button type="button" disabled={sharing} onClick={() => { setSharing(true); void shareActions?.create('embed').finally(() => setSharing(false)); }}>{t('copyEmbedLink')}</button></div>
      {shares.length ? <ul>{shares.map((share) => <li key={share.id}><span>{t('shareUseCount', { count: share.useCount })}{share.expiresAt ? ` · ${t('shareExpires', { date: new Date(share.expiresAt).toLocaleDateString() })}` : ''}</span><button type="button" onClick={() => { void shareActions?.revoke(share.id).then(() => setShares((rows) => rows.filter((row) => row.id !== share.id))); }}>{t('revokeShare')}</button></li>)}</ul> : <p>{t('noActiveShares')}</p>}
    </section>}
    <div className={styles.resumeVersionCreator}>
      <input value={newTitle} placeholder={t('versionNamePlaceholder')} aria-label={t('versionName')} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createVersion(); }} />
      <button type="button" disabled={!onEdit} onClick={createVersion}>{t('createFromOriginal')}</button>
      <button type="button" disabled={!onEdit} onClick={() => input.current?.click()}>{t('importAsVersion')}</button>
      {active.kind === 'derived' && <button type="button" disabled={!onEdit} onClick={() => commit(restoreResumeAsNew(family, active.id, t('restoredVersion', { title: active.title })))}>{t('restoreAsNew')}</button>}
      {active.kind === 'derived' && <button type="button" disabled={!onEdit || active.id === family.masterRevisionId} onClick={() => setPendingLifecycleAction({ kind: 'delete', revisionId: active.id })}>{t('deleteVersion')}</button>}
      {active.kind === 'derived' && <button type="button" disabled={!onDetach} onClick={() => {
        const detached = detachResumeRevision(family, active.id);
        if (detached) onDetach?.({ title: active.title, ...resumeNodePatch(detached), status: t('statusOriginal') });
      }}>{t('detachVersion')}</button>}
      {active.kind === 'derived' && <label className={styles.resumeRename}><span>{t('renameVersion')}</span><input key={active.id} defaultValue={active.title} disabled={!onEdit} onBlur={(event) => {
        const title = event.currentTarget.value.trim();
        if (title && title !== active.title) commit(updateActiveResume(family, { title }));
      }} /></label>}
    </div>
    {pendingLifecycleAction && (() => {
      const revision = family.revisions.find((item) => item.id === pendingLifecycleAction.revisionId);
      if (!revision) return null;
      const descendantCount = family.revisions.filter((item) => item.sourceRevisionId === revision.id).length;
      const promote = pendingLifecycleAction.kind === 'promote';
      return <section className={styles.resumeLifecycleDialog} role="dialog" aria-modal="true" aria-labelledby="resume-lifecycle-title">
        <strong id="resume-lifecycle-title">{promote ? t('confirmMasterTitle') : t('confirmDeleteTitle')}</strong>
        <p>{promote
          ? t('confirmMasterBody', { title: revision.title })
          : t('confirmDeleteBody', { title: revision.title, count: descendantCount })}</p>
        <div>
          <button type="button" autoFocus onClick={() => setPendingLifecycleAction(null)}>{t('cancelLifecycleAction')}</button>
          <button type="button" onClick={() => {
            commit(promote ? promoteResumeToMaster(family, revision.id) : deleteResumeRevision(family, revision.id));
            setPendingLifecycleAction(null);
          }}>{promote ? t('confirmMakeMaster') : t('confirmDeleteVersion')}</button>
        </div>
      </section>;
    })()}
    <div className={styles.resumeControls}>
      <div role="tablist" aria-label={t('viewMode')}>
        {(['edit', 'preview', 'compare'] as const).map((mode) => <button key={mode} type="button" role="tab" aria-selected={view === mode} disabled={mode === 'edit' && active.kind === 'original'} onClick={() => setView(mode)}>{t(mode)}</button>)}
      </div>
      <label><span>{t('template')}</span><select value={active.templateId} disabled={!onEdit} onChange={(event) => changePresentation({ templateId: event.target.value as ResumeTemplateId })}>
        {RESUME_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{t(item.labelKey)}</option>)}
      </select></label>
      <button type="button" aria-expanded={galleryOpen} onClick={() => setGalleryOpen((open) => !open)}>{t('browseTemplates')}</button>
      <button type="button" disabled={!onEdit || family.defaultTemplateId === active.templateId} onClick={() => commit(updateResumeFamilySettings(family, { defaultTemplateId: active.templateId }))}>{family.defaultTemplateId === active.templateId ? t('defaultTemplate') : t('setDefaultTemplate')}</button>
      <label><span>{t('pageSize')}</span><select value={active.pageSize} disabled={!onEdit} onChange={(event) => changePresentation({ pageSize: event.target.value as ResumePageSize })}>
        {(['letter', 'legal', 'a4'] as const).map((size) => <option key={size} value={size}>{t(`pageSize_${size}`)}</option>)}
      </select></label>
      <label><span>{t('orientation')}</span><select value={active.orientation} disabled={!onEdit} onChange={(event) => changePresentation({ orientation: event.target.value as ResumeOrientation })}>
        {(['portrait', 'landscape'] as const).map((orientation) => <option key={orientation} value={orientation}>{t(`orientation_${orientation}`)}</option>)}
      </select></label>
      <label><span>{t('zoom', { zoom: family.viewZoom })}</span><input aria-label={t('zoomControl')} type="range" min="40" max="125" step="5" value={family.viewZoom} disabled={!onEdit} onChange={(event) => commit(updateResumeFamilySettings(family, { viewZoom: Number(event.target.value) }))} /></label>
      <div className={styles.resumePageModes} role="group" aria-label={t('pageViewMode')}>{(['continuous', 'paged', 'spread'] as const).map((mode) => <button key={mode} type="button" aria-pressed={family.previewMode === mode} disabled={!onEdit} onClick={() => commit(updateResumeFamilySettings(family, { previewMode: mode }))}>{t(`pageView_${mode}`)}</button>)}</div>
    </div>
    {galleryOpen && <section className={styles.resumeTemplateGallery} aria-label={t('templateGallery')}>
      {thumbnails.map(({ item, html }) => {
        const selected = active.templateId === item.id;
        return <button key={item.id} type="button" aria-pressed={selected} disabled={!onEdit} onClick={() => changePresentation({ templateId: item.id })}>
          <span className={styles.resumeTemplateThumbnail}><span dangerouslySetInnerHTML={{ __html: html }} /></span>
          <strong>{t(item.labelKey)}</strong><small>{item.industry} · {item.columns === 2 ? t('twoColumns') : t('oneColumn')}</small>
          <em>{item.firstParty ? t('firstPartyTemplate') : item.creator}</em>
          {family.defaultTemplateId === item.id && <i>{t('defaultTemplate')}</i>}
        </button>;
      })}
    </section>}
    <details className={styles.resumeAtsPanel}>
      <summary>{t('aiWritingTools')}</summary>
      <label><span>{t('aiTargetField')}</span><select value={aiField} onChange={(event) => setAiField(event.target.value as ResumeAiField)}>
        <option value="basics.summary">{t('aiFieldSummary')}</option>
        <option value="basics.label">{t('aiFieldHeadline')}</option>
      </select></label>
      <label><span>{t('aiDirection')}</span><textarea value={aiDirection} placeholder={t('aiDirectionPlaceholder')} onChange={(event) => setAiDirection(event.target.value)} /></label>
      <button type="button" disabled={!onTailor || !active.document} onClick={() => onTailor?.(resumeFieldRewritePrompt(active, aiField, aiDirection))}>
        {aiField === 'basics.summary' ? t('rewriteSelectedField') : t('createResumeHook')}
      </button>
    </details>
    <details className={styles.resumeAtsPanel}>
      <summary>{t('tailorForJob')}</summary>
      <label><span>{t('jobDescription')}</span><textarea value={jobDescription} placeholder={t('jobDescriptionPlaceholder')} onChange={(event) => setJobDescription(event.target.value)} /></label>
      {ats && <div className={styles.resumeAtsResults}>
        <strong>{t('atsScore', { score: ats.score })}</strong>
        <div><span>{t('matchedKeywords')}</span>{ats.matchedKeywords.slice(0, 20).map((keyword) => <i key={keyword} data-match>{keyword}</i>)}</div>
        <div><span>{t('missingKeywords')}</span>{ats.missingKeywords.slice(0, 20).map((keyword) => <i key={keyword}>{keyword}</i>)}</div>
      </div>}
      <button type="button" disabled={!onTailor || !active.document || jobDescription.trim().length < 40} onClick={() => {
        if (!active.document || !ats) return;
        onTailor?.(resumeTailorPrompt(active, jobDescription, ats));
      }}>{t('askRecruiterToTailor')}</button>
    </details>
    <details className={styles.resumeAtsPanel}>
      <summary>{t('consolidateBullets')}</summary>
      {bulletSuggestions.length ? <div className={styles.resumeBulletSuggestions}>{bulletSuggestions.map((suggestion) => <article key={suggestion.id}><label><input type="checkbox" checked={!excludedBulletSuggestions.includes(suggestion.id)} onChange={() => setExcludedBulletSuggestions((current) => current.includes(suggestion.id) ? current.filter((id) => id !== suggestion.id) : [...current, suggestion.id])} /><strong>{suggestion.bullet}</strong></label><small>{t('duplicateBulletsFound', { count: suggestion.duplicates.length })}</small>{suggestion.duplicates.map((duplicate, index) => <del key={`${suggestion.id}-${index}`}>{duplicate}</del>)}</article>)}</div> : <p className={styles.resumeEmptyAnalysis}>{t('noDuplicateBullets')}</p>}
      <button type="button" disabled={!onEdit || active.kind === 'original' || !active.document || !selectedBulletSuggestions.length} onClick={() => {
        if (!active.document) return;
        commit(updateActiveResume(family, { document: applyResumeBulletConsolidation(active.document, selectedBulletSuggestions) }));
        setExcludedBulletSuggestions([]);
      }}>{t('applyConsolidation', { count: selectedBulletSuggestions.length })}</button>
    </details>
    {view === 'edit' && active.kind === 'derived' && <div className={styles.resumeEditStack}>
      {active.document && <ResumeStructuredEditor document={active.document} onChange={(document) => commit(updateActiveResume(family, { document }))} />}
      <details className={styles.resumeRawEditor} open={!active.document}><summary>{t('rawTextEditor')}</summary><DocumentEditor markdown={active.markdown} label={t('editorLabel', { title: active.title })} onCommit={(markdown) => commit(updateActiveResume(family, { markdown, structuredStale: !!active.document }))} /></details>
      {active.structuredStale && <p role="status" className={styles.resumeStaleWarning}>{t('structuredStale')}</p>}
    </div>}
    {view === 'preview' && <ResumePreview html={rendered.html} page={page} zoom={family.viewZoom} mode={family.previewMode} onClose={() => setView(active.kind === 'derived' ? 'edit' : 'compare')} />}
    {view === 'compare' && <div className={styles.resumeCompareShell}>
      {active.id !== original.id && <aside className={styles.resumeDiffSummary}>
        <strong>{t('changesFromOriginal', { count: differences.length })}</strong>
        {differences.length ? differences.map((difference) => <label key={difference.section}>
          <input type="checkbox" checked={mergeSections.includes(difference.section)} onChange={() => setMergeSections((current) => current.includes(difference.section) ? current.filter((section) => section !== difference.section) : [...current, difference.section])} />
          <span>{t(`diff_${difference.section}`)} <small>{t('entryChange', { source: difference.sourceCount, target: difference.targetCount })}</small>{difference.fields.length > 0 && <ul className={styles.resumeFieldDiffs}>{difference.fields.slice(0, 12).map((field) => <li key={field.path}><code>{field.path}</code><del>{typeof field.source === 'string' ? field.source : JSON.stringify(field.source)}</del><ins>{typeof field.target === 'string' ? field.target : JSON.stringify(field.target)}</ins></li>)}</ul>}</span>
        </label>) : <p>{t('noStructuredChanges')}</p>}
        <button type="button" disabled={!onEdit || !mergeSections.length || !original.document || !active.document} onClick={() => {
          if (!original.document || !active.document) return;
          const merged = mergeResumeAsNewVersion(family, original, active, new Set(mergeSections), t('mergedVersion', { title: active.title }));
          setMergeSections([]);
          setView('edit');
          commit(merged);
        }}>{t('mergeOriginalSections', { count: mergeSections.length })}</button>
      </aside>}
      <div className={styles.resumeCompare}>
        <section><strong>{t('original')}</strong><div className={styles.resumeCompareViewport} dangerouslySetInnerHTML={{ __html: originalRendered.html }} /></section>
        <section><strong>{t('selectedVersion')}</strong><div className={styles.resumeCompareViewport} dangerouslySetInnerHTML={{ __html: rendered.html }} /></section>
      </div>
    </div>}
  </div>;
}
