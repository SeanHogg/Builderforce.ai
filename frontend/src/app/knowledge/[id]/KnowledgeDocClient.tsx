'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { usePermission } from '@/lib/rbac';
import { useAuth } from '@/lib/AuthContext';
import { useDocCollaboration } from '@/hooks/useDocCollaboration';
import { CanvasBoard } from '@/components/canvas/CanvasBoard';
import { parseCanvas, serializeCanvas } from '@/components/canvas/canvasModel';
import {
  knowledgeApi,
  type KnowledgeDocDetail,
  type DocVersion,
  type DocCompliance,
  type DocType,
  type Collaborator,
  type CollaboratorRole,
  type AnalysisResult,
} from '@/lib/knowledgeApi';
import {
  inputStyle,
  btnPrimary,
  btnGhost,
  badge,
  tagChip,
  label,
  statusColorStyle,
} from '../KnowledgeClient';

const DOC_TYPES: DocType[] = ['sop', 'process', 'doc'];

export default function KnowledgeDocClient({ docId }: { docId: string }) {
  const t = useTranslations('knowledge');
  const router = useRouter();
  const { user } = useAuth();
  const canAssign = usePermission('knowledge.assignTraining').allowed;

  const [doc, setDoc] = useState<KnowledgeDocDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-document edit rights come from the server (owner/manager/invited editor),
  // NOT a workspace-wide role — this is what lets an invited collaborator edit.
  const canEdit = doc?.canEdit ?? false;

  // Editable fields
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [docType, setDocType] = useState<DocType>('sop');
  const [requiresAck, setRequiresAck] = useState(false);
  const [tags, setTags] = useState<string[]>([]);

  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const dirtyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Caret to restore after a remote collaborative edit re-renders the textarea.
  const pendingCaretRef = useRef<number | null>(null);

  const collab = useDocCollaboration(docId, {
    userId: user?.id ?? '',
    name: user?.name || user?.email || 'Teammate',
    initialContent: content,
  });

  // Adopt remote collaborative edits into the editor content. Guard against an
  // empty freshly-seeded room clobbering content we just loaded from the API:
  // only adopt a non-empty remote value, or when our own buffer is still empty.
  useEffect(() => {
    if (!collab.enabled || collab.value === null || collab.value === content) return;
    if (collab.value.length === 0 && content.length > 0) return;
    // Capture the caret so the incoming remote edit doesn't kick it to the end.
    const ta = textareaRef.current;
    if (ta && document.activeElement === ta) pendingCaretRef.current = ta.selectionStart;
    setContent(collab.value);
    dirtyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collab.value, collab.enabled]);

  // Restore the caret after a remote-driven content change (best-effort; only
  // ever set on the collaborative path, so single-user editing is untouched).
  useLayoutEffect(() => {
    if (pendingCaretRef.current == null) return;
    const ta = textareaRef.current;
    if (ta) {
      const pos = Math.min(pendingCaretRef.current, content.length);
      ta.setSelectionRange(pos, pos);
    }
    pendingCaretRef.current = null;
  }, [content]);

  const reload = useCallback(() => {
    knowledgeApi
      .get(docId)
      .then((d) => {
        setDoc(d);
        setTitle(d.title);
        setSummary(d.summary ?? '');
        setContent(d.content);
        setDocType(d.docType);
        setRequiresAck(d.requiresAck);
        setTags(d.tags);
        setMode(d.canEdit ? 'edit' : 'preview');
      })
      .catch((e: Error) => setError(e.message));
  }, [docId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Debounced autosave (anyone with edit access to this document).
  useEffect(() => {
    if (!doc || !canEdit || !dirtyRef.current) return;
    setSaveState('saving');
    const handle = setTimeout(async () => {
      try {
        await knowledgeApi.update(docId, {
          title: title.trim() || doc.title,
          summary,
          content,
          docType,
          requiresAck,
        });
        await knowledgeApi.setTags(docId, tags);
        dirtyRef.current = false;
        setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 1500);
      } catch {
        setSaveState('idle');
      }
    }, 900);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, summary, content, docType, requiresAck, tags]);

  const onContentChange = (next: string) => {
    dirtyRef.current = true;
    if (collab.enabled) collab.setValue(next);
    else setContent(next);
    if (collab.enabled) setContent(next);
  };

  const markDirty = <T,>(setter: (v: T) => void) => (v: T) => {
    dirtyRef.current = true;
    setter(v);
  };

  // A canvas document stores its board (JSON) inside `content`. When detected we
  // swap the Markdown editor for the reusable <CanvasBoard>; edits serialise back
  // through the same content path (autosave + realtime collab unchanged).
  const canvasModel = useMemo(() => parseCanvas(content), [content]);

  if (error) {
    return (
      <PageContainer width="readable">
        <div style={{ color: 'var(--error-text, #f87171)' }}>{error}</div>
        <Link href="/knowledge" style={{ color: 'var(--accent, #60a5fa)' }}>
          ← {t('backToList')}
        </Link>
      </PageContainer>
    );
  }
  if (!doc) {
    return (
      <PageContainer width="readable">
        <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('loading')}</div>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="readable">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link href="/knowledge" style={{ color: 'var(--accent, #60a5fa)', textDecoration: 'none' }}>
          ← {t('backToList')}
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PresenceBar collab={collab} t={t} />
          {saveState !== 'idle' && (
            <span style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>
              {saveState === 'saving' ? t('saving') : t('saved')}
            </span>
          )}
          <span style={{ ...badge, ...statusColorStyle(doc.status) }}>{t(`status_${doc.status}`)}</span>
        </div>
      </div>

      {/* Title */}
      {canEdit ? (
        <input
          value={title}
          onChange={(e) => markDirty(setTitle)(e.target.value)}
          style={{ ...inputStyle, fontSize: 24, fontWeight: 700, width: '100%', marginTop: 16 }}
        />
      ) : (
        <h1 style={{ marginTop: 16 }}>{doc.title}</h1>
      )}

      {/* Share / collaborators */}
      <SharePanel doc={doc} canEdit={canEdit} t={t} />

      {/* Meta row (editors) */}
      {canEdit && (
        <>
          <div style={{ display: 'flex', gap: 10, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={docType} onChange={(e) => markDirty(setDocType)(e.target.value as DocType)} style={inputStyle}>
              {DOC_TYPES.map((dt) => (
                <option key={dt} value={dt}>
                  {t(`type_${dt}`)}
                </option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={requiresAck} onChange={(e) => markDirty(setRequiresAck)(e.target.checked)} />
              {t('requiresAckLabel')}
            </label>
          </div>
          <input
            value={summary}
            onChange={(e) => markDirty(setSummary)(e.target.value)}
            placeholder={t('fieldSummary')}
            style={{ ...inputStyle, width: '100%' }}
          />
          <TagEditor tags={tags} onChange={markDirty(setTags)} t={t} />
        </>
      )}

      {/* Acknowledge banner */}
      {doc.status === 'published' && (
        <AcknowledgeBanner doc={doc} t={t} onAck={reload} />
      )}

      {/* AI assist (editors) */}
      {canEdit && (
        <AiAssist
          docType={docType}
          title={title}
          existingContent={content}
          t={t}
          onApply={(text, replace) => {
            onContentChange(replace ? text : `${content}\n\n${text}`);
            setMode('edit');
          }}
        />
      )}

      {/* AI process analysis (editors) */}
      {canEdit && content.trim() && (
        <AnalyzePanel
          docId={docId}
          t={t}
          onApplyFlow={(flow) => {
            onContentChange(flow);
            setMode('edit');
          }}
        />
      )}

      {/* Canvas documents render the reusable board; Markdown docs the editor. */}
      {canvasModel ? (
        <div style={{ margin: '18px 0 8px' }}>
          <CanvasBoard
            value={canvasModel}
            readOnly={!canEdit}
            onChange={(next) => onContentChange(serializeCanvas(next))}
            height={560}
          />
        </div>
      ) : (
        <>
      {/* Content edit/preview */}
      <div style={{ display: 'flex', gap: 8, margin: '18px 0 8px' }}>
        {canEdit && (
          <>
            <button type="button" onClick={() => setMode('edit')} style={mode === 'edit' ? btnPrimary : btnGhost}>
              {t('edit')}
            </button>
            <button type="button" onClick={() => setMode('preview')} style={mode === 'preview' ? btnPrimary : btnGhost}>
              {t('preview')}
            </button>
          </>
        )}
      </div>

      {mode === 'edit' && canEdit ? (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          style={{
            width: '100%',
            minHeight: 420,
            padding: 16,
            borderRadius: 10,
            border: '1px solid var(--border, #333)',
            background: 'var(--surface-2, #111)',
            color: 'inherit',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 14,
            lineHeight: 1.6,
            resize: 'vertical',
          }}
          placeholder={t('contentPlaceholder')}
        />
      ) : (
        <article
          style={{
            padding: 20,
            borderRadius: 10,
            border: '1px solid var(--border, #333)',
            background: 'var(--surface, #1a1a1a)',
            minHeight: 200,
          }}
          className="markdown-body"
        >
          {content.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          ) : (
            <span style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('emptyContent')}</span>
          )}
        </article>
      )}
        </>
      )}

      {/* Publish / delete (editors) */}
      {canEdit && (
        <PublishBar doc={doc} t={t} onPublished={reload} onDeleted={() => router.push('/knowledge')} />
      )}

      {/* Versions + training/compliance */}
      <VersionHistory docId={docId} t={t} />
      {canAssign && <TrainingPanel docId={docId} t={t} />}
    </PageContainer>
  );
}

function SharePanel({
  doc,
  canEdit,
  t,
}: {
  doc: KnowledgeDocDetail;
  canEdit: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ owner: { userId: string; name: string } | null; collaborators: Collaborator[] } | null>(null);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  const [pick, setPick] = useState('');
  const [role, setRole] = useState<CollaboratorRole>('editor');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    knowledgeApi.collaborators(doc.id).then(setData).catch(() => setData(null));
  }, [doc.id]);

  useEffect(() => {
    if (!open) return;
    load();
    if (canEdit) {
      knowledgeApi.members().then((m) => setMembers(m.map((x) => ({ userId: x.userId, name: x.name })))).catch(() => setMembers([]));
    }
  }, [open, load, canEdit]);

  async function invite() {
    if (!pick) return;
    setBusy(true);
    try {
      await knowledgeApi.invite(doc.id, pick, role);
      setPick('');
      load();
    } finally {
      setBusy(false);
    }
  }
  async function remove(userId: string) {
    setBusy(true);
    try {
      await knowledgeApi.removeCollaborator(doc.id, userId);
      load();
    } finally {
      setBusy(false);
    }
  }

  const collaborators = data?.collaborators ?? [];
  const taken = new Set<string>([data?.owner?.userId, ...collaborators.map((cc) => cc.userId)].filter(Boolean) as string[]);
  const candidates = members.filter((m) => !taken.has(m.userId));

  return (
    <div
      style={{
        margin: '14px 0',
        borderRadius: 10,
        border: '1px solid var(--border, #333)',
        background: 'var(--surface, #1a1a1a)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 16px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontWeight: 600,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        👥 {t('share')}
        {collaborators.length > 0 && (
          <span style={{ ...badge, background: 'var(--surface-2, #222)', color: 'var(--text-muted, #9ca3af)' }}>
            {collaborators.length}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: 16, paddingTop: 0, display: 'grid', gap: 12 }}>
          {!canEdit && (
            <p style={{ fontSize: 13, color: 'var(--text-muted, #9ca3af)', margin: 0 }}>
              {doc.myAccess === 'viewer' ? t('accessViewerNote') : t('accessReadOnlyNote')}
            </p>
          )}
          <div style={{ display: 'grid', gap: 6 }}>
            {data?.owner && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <span>{data.owner.name}</span>
                <span style={{ ...badge, background: 'var(--surface-2, #222)', color: 'var(--text-muted, #9ca3af)' }}>
                  {t('owner')}
                </span>
              </div>
            )}
            {collaborators.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted, #9ca3af)' }}>{t('noCollaborators')}</div>
            )}
            {collaborators.map((cc) => (
              <div key={cc.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <span>{cc.name}</span>
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ ...badge, background: 'var(--surface-2, #222)', color: 'var(--text-muted, #9ca3af)' }}>
                    {t(cc.role === 'viewer' ? 'roleViewer' : 'roleEditor')}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove(cc.userId)}
                      disabled={busy}
                      style={{ background: 'none', border: 'none', color: 'var(--error-text, #f87171)', cursor: 'pointer' }}
                      aria-label={t('remove')}
                    >
                      ×
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>

          {canEdit && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={pick} onChange={(e) => setPick(e.target.value)} style={inputStyle}>
                <option value="">{t('selectMember')}</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
              <select value={role} onChange={(e) => setRole(e.target.value as CollaboratorRole)} style={inputStyle}>
                <option value="editor">{t('roleEditor')}</option>
                <option value="viewer">{t('roleViewer')}</option>
              </select>
              <button type="button" onClick={invite} disabled={busy || !pick} style={btnPrimary}>
                {busy ? t('inviting') : t('invite')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PresenceBar({ collab, t }: { collab: ReturnType<typeof useDocCollaboration>; t: ReturnType<typeof useTranslations> }) {
  if (!collab.enabled) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={t('liveCollab')}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: collab.connected ? 'var(--success-text, #4ade80)' : 'var(--text-muted, #9ca3af)',
        }}
      />
      <div style={{ display: 'flex' }}>
        {collab.peers.slice(0, 5).map((p) => (
          <span
            key={p.userId}
            title={p.name}
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              background: p.color,
              color: '#fff',
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: -6,
              border: '2px solid var(--surface, #1a1a1a)',
            }}
          >
            {p.name.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
      {collab.peers.length > 0 && (
        <span style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>{t('editingNow')}</span>
      )}
    </div>
  );
}

function TagEditor({
  tags,
  onChange,
  t,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim().toLowerCase();
    if (v && !tags.includes(v)) onChange([...tags, v]);
    setDraft('');
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
      {tags.map((tg) => (
        <span key={tg} style={{ ...tagChip, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          {tg}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== tg))}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
            aria-label={t('removeTag')}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        placeholder={t('addTag')}
        style={{ ...inputStyle, minWidth: 120, padding: '4px 8px', fontSize: 13 }}
      />
    </div>
  );
}

function AcknowledgeBanner({
  doc,
  t,
  onAck,
}: {
  doc: KnowledgeDocDetail;
  t: ReturnType<typeof useTranslations>;
  onAck: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const current = doc.myAcknowledgement?.current;
  async function ack() {
    setBusy(true);
    try {
      await knowledgeApi.acknowledge(doc.id);
      onAck();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        margin: '16px 0',
        borderRadius: 10,
        border: '1px solid var(--border, #333)',
        background: current ? 'var(--success-bg, #0f3d2e)' : 'var(--surface-2, #1a1a1a)',
      }}
    >
      <div style={{ fontSize: 14 }}>
        {current ? (
          <span>
            ✓ {t('youAcknowledged')}
            {doc.myAcknowledgement?.acknowledgedAt &&
              ` — ${new Date(doc.myAcknowledgement.acknowledgedAt).toLocaleDateString()}`}
          </span>
        ) : (
          <span>{doc.requiresAck ? t('ackRequiredPrompt') : t('ackPrompt')}</span>
        )}
      </div>
      {!current && (
        <button type="button" onClick={ack} disabled={busy} style={btnPrimary}>
          {busy ? t('acknowledging') : t('acknowledge')}
        </button>
      )}
    </div>
  );
}

function AiAssist({
  docType,
  title,
  existingContent,
  t,
  onApply,
}: {
  docType: DocType;
  title: string;
  existingContent: string;
  t: ReturnType<typeof useTranslations>;
  onApply: (text: string, replace: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!prompt.trim()) return;
    setBusy(true);
    setError(null);
    setResult('');
    try {
      const final = await knowledgeApi.aiDraftStream(
        {
          prompt: prompt.trim(),
          docType,
          title: title || undefined,
          existingContent: existingContent.trim() || undefined,
        },
        (accumulated) => setResult(accumulated),
      );
      setResult(final.trim() || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI failed');
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        margin: '16px 0',
        borderRadius: 10,
        border: '1px solid var(--accent, #2563eb)',
        background: 'var(--surface, #1a1a1a)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 16px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        ✨ {t('aiAssist')} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div style={{ padding: 16, paddingTop: 0 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted, #9ca3af)', marginTop: 0 }}>{t('aiHint')}</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('aiPromptPlaceholder')}
            style={{
              width: '100%',
              minHeight: 70,
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border, #333)',
              background: 'var(--surface-2, #111)',
              color: 'inherit',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={generate} disabled={busy || !prompt.trim()} style={btnPrimary}>
              {busy ? t('generating') : t('generate')}
            </button>
          </div>
          {error && <div style={{ color: 'var(--error-text, #f87171)', marginTop: 8 }}>{error}</div>}
          {result && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: '1px solid var(--border, #333)',
                  background: 'var(--surface-2, #111)',
                  maxHeight: 260,
                  overflow: 'auto',
                }}
                className="markdown-body"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => { onApply(result, true); setResult(null); }} style={btnPrimary}>
                  {t('aiReplace')}
                </button>
                <button type="button" onClick={() => { onApply(result, false); setResult(null); }} style={btnGhost}>
                  {t('aiInsert')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function severityColor(severity: string): React.CSSProperties {
  if (severity === 'high') return { background: 'var(--error-bg, #3d0f0f)', color: 'var(--error-text, #f87171)' };
  if (severity === 'medium') return { background: 'var(--warning-bg, #3d320f)', color: 'var(--warning-text, #fbbf24)' };
  return { background: 'var(--surface-2, #222)', color: 'var(--text-muted, #9ca3af)' };
}

function AnalyzePanel({
  docId,
  t,
  onApplyFlow,
}: {
  docId: string;
  t: ReturnType<typeof useTranslations>;
  onApplyFlow: (flow: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await knowledgeApi.analyze(docId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        margin: '16px 0',
        borderRadius: 10,
        border: '1px solid var(--border, #333)',
        background: 'var(--surface, #1a1a1a)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '10px 16px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        🔍 {t('analyzeTitle')} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div style={{ padding: 16, paddingTop: 0 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted, #9ca3af)', marginTop: 0 }}>{t('analyzeHint')}</p>
          <button type="button" onClick={run} disabled={busy} style={btnPrimary}>
            {busy ? t('analyzing') : t('analyzeRun')}
          </button>
          {error && <div style={{ color: 'var(--error-text, #f87171)', marginTop: 8 }}>{error}</div>}
          {result && (
            <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
              {result.summary && <p style={{ margin: 0, fontSize: 14 }}>{result.summary}</p>}
              {result.findings.length === 0 ? (
                <div style={{ color: 'var(--text-muted, #9ca3af)', fontSize: 13 }}>{t('analyzeNoFindings')}</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {result.findings.map((f, i) => (
                    <div
                      key={i}
                      style={{ padding: 12, borderRadius: 8, border: '1px solid var(--border, #333)', background: 'var(--surface-2, #111)' }}
                    >
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ ...badge, ...severityColor(f.severity) }}>{t(`severity_${f.severity}`)}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>{t(`category_${f.category}`)}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{f.issue}</div>
                      {f.recommendation && (
                        <div style={{ fontSize: 13, color: 'var(--text-muted, #9ca3af)', marginTop: 4 }}>
                          → {f.recommendation}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {result.improvedFlow && (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, margin: '4px 0 6px' }}>{t('analyzeImprovedFlow')}</div>
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      border: '1px solid var(--border, #333)',
                      background: 'var(--surface-2, #111)',
                      maxHeight: 220,
                      overflow: 'auto',
                    }}
                    className="markdown-body"
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.improvedFlow}</ReactMarkdown>
                  </div>
                  <button
                    type="button"
                    onClick={() => { onApplyFlow(result.improvedFlow); setResult(null); }}
                    style={{ ...btnPrimary, marginTop: 8 }}
                  >
                    {t('analyzeApplyFlow')}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PublishBar({
  doc,
  t,
  onPublished,
  onDeleted,
}: {
  doc: KnowledgeDocDetail;
  t: ReturnType<typeof useTranslations>;
  onPublished: () => void;
  onDeleted: () => void;
}) {
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function publish() {
    setBusy(true);
    try {
      await knowledgeApi.publish(doc.id, changeNote.trim() || undefined);
      setChangeNote('');
      onPublished();
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(t('deleteConfirm'))) return;
    setBusy(true);
    try {
      await knowledgeApi.remove(doc.id);
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        margin: '20px 0',
        flexWrap: 'wrap',
        paddingTop: 16,
        borderTop: '1px solid var(--border, #333)',
      }}
    >
      <input
        value={changeNote}
        onChange={(e) => setChangeNote(e.target.value)}
        placeholder={t('changeNotePlaceholder')}
        style={{ ...inputStyle, flex: 1, minWidth: 200 }}
      />
      <button type="button" onClick={publish} disabled={busy} style={btnPrimary}>
        {busy ? t('publishing') : doc.versionNumber > 0 ? t('publishNewVersion') : t('publish')}
      </button>
      <button type="button" onClick={remove} disabled={busy} style={{ ...btnGhost, color: 'var(--error-text, #f87171)' }}>
        {t('deleteDoc')}
      </button>
    </div>
  );
}

function VersionHistory({ docId, t }: { docId: string; t: ReturnType<typeof useTranslations> }) {
  const [versions, setVersions] = useState<DocVersion[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open && versions.length === 0) {
      knowledgeApi.versions(docId).then(setVersions).catch(() => {});
    }
  }, [open, docId, versions.length]);

  return (
    <section style={{ marginTop: 28 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: 16, padding: 0 }}
      >
        {t('versionHistory')} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {versions.length === 0 && <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('noVersions')}</div>}
          {versions.map((v) => (
            <div
              key={v.id}
              style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border, #333)', background: 'var(--surface, #1a1a1a)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>v{v.versionNumber}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)' }}>
                  {new Date(v.createdAt).toLocaleString()}
                </span>
              </div>
              {v.changeNote && <div style={{ fontSize: 13, marginTop: 4 }}>{v.changeNote}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

interface MemberRow {
  userId: string;
  name: string;
}

function TrainingPanel({ docId, t }: { docId: string; t: ReturnType<typeof useTranslations> }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [compliance, setCompliance] = useState<DocCompliance | null>(null);
  const [open, setOpen] = useState(false);

  const loadCompliance = useCallback(() => {
    knowledgeApi.compliance(docId).then(setCompliance).catch(() => setCompliance(null));
  }, [docId]);

  useEffect(() => {
    if (!open) return;
    knowledgeApi
      .members()
      .then((res) => setMembers(res.map((m) => ({ userId: m.userId, name: m.name }))))
      .catch(() => setMembers([]));
    loadCompliance();
  }, [open, loadCompliance]);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function assign() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await knowledgeApi.assignTraining(docId, Array.from(selected), dueAt ? new Date(dueAt).toISOString() : null);
      setSelected(new Set());
      setDueAt('');
      loadCompliance();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--border, #333)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: 16, padding: 0 }}
      >
        🎓 {t('trainingAndAudit')} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div style={{ marginTop: 14, display: 'grid', gap: 18 }}>
          <div>
            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('assignTraining')}</h3>
            <div
              style={{
                maxHeight: 180,
                overflow: 'auto',
                border: '1px solid var(--border, #333)',
                borderRadius: 8,
                padding: 8,
              }}
            >
              {members.length === 0 && <div style={{ color: 'var(--text-muted, #9ca3af)', fontSize: 13 }}>{t('noMembers')}</div>}
              {members.map((m) => (
                <label key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(m.userId)} onChange={() => toggle(m.userId)} />
                  {m.name}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 13, color: 'var(--text-muted, #9ca3af)' }}>{t('dueDate')}</label>
              <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={inputStyle} />
              <button type="button" onClick={assign} disabled={busy || selected.size === 0} style={btnPrimary}>
                {busy ? t('assigning') : `${t('assign')}${selected.size ? ` (${selected.size})` : ''}`}
              </button>
            </div>
          </div>

          {compliance && (
            <div>
              <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>
                {t('readStatus')} — {compliance.summary.percent}% ({compliance.summary.acknowledged}/{compliance.summary.required})
              </h3>
              {compliance.rows.length === 0 ? (
                <div style={{ color: 'var(--text-muted, #9ca3af)', fontSize: 13 }}>{t('noReadersRequired')}</div>
              ) : (
                <div style={{ display: 'grid', gap: 4 }}>
                  {compliance.rows.map((r) => (
                    <div
                      key={r.userId}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '4px 0' }}
                    >
                      <span>{r.name}</span>
                      <span
                        style={{
                          ...badge,
                          ...(r.state === 'acknowledged'
                            ? { background: 'var(--success-bg, #0f3d2e)', color: 'var(--success-text, #4ade80)' }
                            : r.state === 'overdue'
                              ? { background: 'var(--error-bg, #3d0f0f)', color: 'var(--error-text, #f87171)' }
                              : { background: 'var(--warning-bg, #3d320f)', color: 'var(--warning-text, #fbbf24)' }),
                        }}
                      >
                        {t(`state_${r.state}`)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
