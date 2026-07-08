'use client';

export const runtime = 'edge';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { fetchProject, fetchFiles, updateProject, deleteProject, fetchIdeProjectByStorage } from '@/lib/api';
import { persistLastProjectId } from '@/lib/auth';
import type { Project, FileEntry, IdeProject } from '@/lib/types';
import { ProjectDetailsPanel } from '@/components/ProjectDetailsPanel';
import { IdeProjectDetailsModal } from '@/components/IdeProjectDetailsModal';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary';

// All modalities (designer/video/llm/voice) now render through the one IDE shell,
// which scopes each modality's panels to this project. Loaded lazily so the heavy
// editor/WebGPU bundles only ship when a project is actually opened.
const IDE = dynamic(() => import('@/components/IDE').then((m) => m.IDE), { ssr: false });

/** Work-item kinds a chat can be auto-linked to (mirror ChatTicketService.TICKET_KINDS). */
const TICKET_PARAM_KINDS = new Set(['portfolio', 'objective', 'initiative', 'roadmap', 'spec', 'epic', 'gap', 'task']);

/** Parse a `?ticket=<kind>:<ref>` deep link into { kind, ref }, or undefined. Split on
 *  the FIRST ':' only — a uuid ref never contains one, and kinds are colon-free. */
function parseTicketParam(raw: string | null): { kind: string; ref: string } | undefined {
  if (!raw) return undefined;
  const i = raw.indexOf(':');
  if (i <= 0) return undefined;
  const kind = raw.slice(0, i);
  const ref = raw.slice(i + 1);
  return kind && ref && TICKET_PARAM_KINDS.has(kind) ? { kind, ref } : undefined;
}

/**
 * IDE page — opens a project in the IDE. Use ?chat= to open with a specific project chat active
 * (e.g. from Brain Storm "Open in IDE" with the current chat).
 */
export default function IDEPage() {
  const params = useParams<{ id: string }>();
  const tFirst = useTranslations('ideFirstRun');
  const tc = useTranslations('common');
  const t = useTranslations('idePage');
  const router = useRouter();
  const searchParams = useSearchParams();
  const idRaw = params?.id ?? '';
  const id = idRaw;
  const chatIdParam = searchParams.get('chat');
  const initialChatId = chatIdParam ? (Number(chatIdParam) || null) : null;

  // One-shot Brain seed via ?prompt= (e.g. Project 360 "Improve with Brain") and/or an
  // auto-link via ?ticket=<kind>:<ref> (click an item → open a chat already tied to it,
  // parity with the VS Code "open task" flow). Both captured once, then stripped from
  // the URL so a refresh/share doesn't re-fire them.
  const [initialPrompt] = useState(() => searchParams.get('prompt') ?? undefined);
  const [initialTicket] = useState(() => parseTicketParam(searchParams.get('ticket')));
  const oneShotStrippedRef = useRef(false);
  useEffect(() => {
    if (oneShotStrippedRef.current || (!searchParams.get('prompt') && !searchParams.get('ticket'))) return;
    oneShotStrippedRef.current = true;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('prompt');
    params.delete('ticket');
    const qs = params.toString();
    router.replace(qs ? `/ide/${idRaw}?${qs}` : `/ide/${idRaw}`);
  }, [searchParams, router, idRaw]);

  const [project, setProject] = useState<Project | null>(null);
  // The IDE project (0224) backing this storage project — resolved so "Details"
  // opens THIS project's own settings (name, parent, modality, workflow) rather
  // than the parent PM Project's details. Null when the opened project isn't an
  // IDE project (e.g. a raw PM project), where we fall back to the PM panel.
  const [ideProject, setIdeProject] = useState<IdeProject | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'notfound' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [showFirstTimeModal, setShowFirstTimeModal] = useState(false);
  const [firstTimeProjectName, setFirstTimeProjectName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);

  useEffect(() => {
    if (!idRaw) return;
    let cancelled = false;
    const projectId = idRaw;

    Promise.all([
      fetchProject(projectId),
      fetchFiles(projectId),
    ])
      .then(([proj, fileList]) => {
        if (cancelled) return;
        setProject(proj);
        setFiles(fileList);
        setStatus('ready');
        persistLastProjectId(proj.publicId ?? String(proj.id));
        // Resolve the IDE project backing this storage project so "Details" shows
        // the IDE project's own settings. 404 (not an IDE project) → null → the
        // PM Project details fallback.
        fetchIdeProjectByStorage(proj.id)
          .then((ide) => { if (!cancelled) setIdeProject(ide); })
          .catch(() => { if (!cancelled) setIdeProject(null); });
        const isUntitled = proj.name === 'Untitled' || proj.name.startsWith('Untitled-');
        if (isUntitled && typeof sessionStorage !== 'undefined') {
          const key = 'builderforce-first-time-modal-shown';
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            setShowFirstTimeModal(true);
          }
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
          setStatus('notfound');
        } else {
          setErrorMsg(msg);
          setStatus('error');
        }
      });

    return () => { cancelled = true; };
  }, [idRaw]);

  if (status === 'loading') {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-deep)', color: 'var(--text-secondary)',
        gap: 16, fontFamily: 'var(--font-display)',
      }}>
        <div style={{ fontSize: '2.5rem', animation: 'pulse 1.5s ease-in-out infinite' }}>⚡</div>
        <p>{t('loading')}</p>
      </div>
    );
  }

  if (status === 'notfound') {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-deep)', color: 'var(--text-primary)',
        gap: 12, textAlign: 'center', fontFamily: 'var(--font-display)',
      }}>
        <div style={{ fontSize: '4rem', marginBottom: 8 }}>🔍</div>
        <h1 style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--coral-bright)' }}>404</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{t('notFound')}</p>
        <button
          onClick={() => router.push('/dashboard')}
          style={{
            marginTop: 16,
            background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
            color: '#fff', border: 'none', padding: '10px 24px',
            borderRadius: 12, fontFamily: 'var(--font-display)',
            fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem',
          }}
        >
          ← {t('backToDashboard')}
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-deep)', color: 'var(--text-primary)',
        gap: 12, textAlign: 'center', padding: 24, fontFamily: 'var(--font-display)',
      }}>
        <div style={{ fontSize: '3rem' }}>⚠️</div>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700 }}>{t('loadError')}</h2>
        <pre style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          borderRadius: 10, padding: '12px 20px', fontSize: '0.78rem',
          color: 'var(--error-text)', maxWidth: 560, overflowX: 'auto', whiteSpace: 'pre-wrap',
        }}>
          {errorMsg || t('unknownError')}
        </pre>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => window.location.reload()}
            style={{ background: 'var(--surface-interactive)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', padding: '8px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
            {t('retry')}
          </button>
          <button onClick={() => router.push('/dashboard')}
            style={{ background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 600 }}>
            {t('dashboard')}
          </button>
        </div>
      </div>
    );
  }

  const isUntitled = project!.name === 'Untitled' || project!.name.startsWith('Untitled-');
  const openFirstTimeModal = isUntitled && showFirstTimeModal;

  const handleSaveProjectName = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = firstTimeProjectName.trim();
    if (!name || !project) return;
    setIsSavingName(true);
    try {
      const updated = await updateProject(project.id, { name });
      setProject(updated);
      setShowFirstTimeModal(false);
      setFirstTimeProjectName('');
    } catch {
      // keep modal open
    } finally {
      setIsSavingName(false);
    }
  };

  return (
    <>
      <div className="ide-full-height" style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ChunkErrorBoundary>
          <IDE
            project={project!}
            initialFiles={files}
            onProjectUpdate={setProject}
            onOpenProjectDetails={() => setProjectDetailsOpen(true)}
            initialChatId={initialChatId}
            initialPrompt={initialPrompt}
            initialTicket={initialTicket}
          />
        </ChunkErrorBoundary>
      </div>
      {/* "Details" opens the IDE project's own settings (memory/model/voice config
          lives in the IDE panels; this is where you rename it + set its parent).
          Only a raw PM project (no backing IDE project) falls back to the PM panel. */}
      {projectDetailsOpen && ideProject && (
        <IdeProjectDetailsModal
          ideProject={ideProject}
          onClose={() => setProjectDetailsOpen(false)}
          onSaved={(updated) => {
            setIdeProject(updated);
            // Keep the IDE title bar in sync when the name changes here.
            setProject((prev) => (prev ? { ...prev, name: updated.name } : prev));
            setProjectDetailsOpen(false);
          }}
        />
      )}
      {project && !ideProject && (
        <ProjectDetailsPanel
          project={project}
          open={projectDetailsOpen}
          onClose={() => setProjectDetailsOpen(false)}
          onProjectUpdate={setProject}
          onDelete={async (p) => {
            try {
              await deleteProject(p.id);
              router.push('/dashboard');
            } catch (err) {
              console.error(err);
              alert(t('deleteFailed'));
            }
          }}
        />
      )}
      <SlideOutPanel
        open={openFirstTimeModal}
        onClose={() => setShowFirstTimeModal(false)}
        title={tFirst('title')}
        width="min(480px, 96vw)"
      >
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            {tFirst('subtitle')}
          </p>
          <form onSubmit={handleSaveProjectName} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <input
              type="text"
              value={firstTimeProjectName}
              onChange={(e) => setFirstTimeProjectName(e.target.value)}
              placeholder={tFirst('namePlaceholder')}
              autoFocus
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: 'var(--bg-deep)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 10,
                padding: '10px 14px',
                fontSize: '0.95rem',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowFirstTimeModal(false)}
                style={{
                  padding: '8px 16px',
                  fontSize: '0.9rem',
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 10,
                  cursor: 'pointer',
                }}
              >
                {tFirst('later')}
              </button>
              <button
                type="submit"
                disabled={isSavingName || !firstTimeProjectName.trim()}
                style={{
                  padding: '8px 18px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: '#fff',
                  background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                  border: 'none',
                  borderRadius: 10,
                  cursor: isSavingName || !firstTimeProjectName.trim() ? 'not-allowed' : 'pointer',
                  opacity: isSavingName || !firstTimeProjectName.trim() ? 0.7 : 1,
                }}
              >
                {isSavingName ? tc('saving') : tc('save')}
              </button>
            </div>
          </form>
        </div>
      </SlideOutPanel>
    </>
  );
}
