'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useOptionalProjectScope } from '@/lib/ProjectScopeContext';
import { knowledgeApi, type KnowledgeTemplate, type DocType } from '@/lib/knowledgeApi';
import { emptyCanvas, serializeCanvas } from '@/components/canvas/canvasModel';
import { useCreateKnowledge } from '../useCreateKnowledge';

/**
 * Template gallery — the Google-Docs-style replacement for the old create modal.
 * You pick a starting point and the document OPENS (created as a draft, then
 * routed into the editor). No blocking modal, no required title.
 *
 * "Start blank" covers the document types + a blank canvas; "Standard templates"
 * lists the curated library, marking which standards the team already has.
 */

interface BlankStarter {
  key: string;
  labelKey: string;
  descKey: string;
  icon: string;
  docType: DocType;
  /** Canvas blanks seed `content` with an empty serialized canvas model. */
  canvas?: boolean;
}

const BLANKS: BlankStarter[] = [
  { key: 'blank-doc', labelKey: 'blankDoc', descKey: 'blankDocDesc', icon: '📄', docType: 'doc' },
  { key: 'blank-sop', labelKey: 'blankSop', descKey: 'blankSopDesc', icon: '📋', docType: 'sop' },
  { key: 'blank-process', labelKey: 'blankProcess', descKey: 'blankProcessDesc', icon: '🔁', docType: 'process' },
  { key: 'blank-canvas', labelKey: 'blankCanvas', descKey: 'blankCanvasDesc', icon: '🧩', docType: 'doc', canvas: true },
];

const DOC_TYPE_LABELS: Record<DocType, string> = { sop: 'type_sop', process: 'type_process', doc: 'type_doc' };

export default function NewKnowledgeClient() {
  const t = useTranslations('knowledge');
  const scope = useOptionalProjectScope();
  const projectId = scope?.currentProjectId ?? null;
  const { create, creatingKey, error } = useCreateKnowledge(projectId);

  const [templates, setTemplates] = useState<KnowledgeTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    knowledgeApi
      .overview()
      .then((o) => setTemplates(o.templates))
      .catch(() => setTemplates([]))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <PageContainer>
      <div style={{ display: 'grid', gap: 28 }}>
        <header>
          <Link href="/knowledge" style={{ color: 'var(--accent, #60a5fa)', textDecoration: 'none', fontSize: 13 }}>
            ← {t('backToList')}
          </Link>
          <h1 style={{ margin: '8px 0 0', fontSize: 24 }}>{t('galleryTitle')}</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted, #9ca3af)', maxWidth: 680 }}>{t('gallerySubtitle')}</p>
        </header>

        {error && <div style={{ color: 'var(--error-text, #f87171)' }}>{error}</div>}

        <section>
          <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{t('startBlank')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {BLANKS.map((b) => (
              <TemplateCard
                key={b.key}
                icon={b.icon}
                title={t(b.labelKey)}
                desc={t(b.descKey)}
                busy={creatingKey === b.key}
                onClick={() =>
                  create({
                    busyKey: b.key,
                    docType: b.docType,
                    title: t(b.labelKey),
                    content: b.canvas ? serializeCanvas(emptyCanvas()) : undefined,
                  })
                }
              />
            ))}
          </div>
        </section>

        <section>
          <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{t('standardTemplates')}</h2>
          {!loaded && <div style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('loading')}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {templates.map((tpl) => (
              <TemplateCard
                key={tpl.key}
                icon={tpl.docType === 'sop' ? '📋' : tpl.docType === 'process' ? '🔁' : '📄'}
                title={tpl.title}
                desc={tpl.summary}
                badge={t(DOC_TYPE_LABELS[tpl.docType])}
                hint={tpl.present ? t('alreadyHave') : undefined}
                busy={creatingKey === tpl.key}
                onClick={() => create({ templateKey: tpl.key })}
              />
            ))}
          </div>
        </section>
      </div>
    </PageContainer>
  );
}

function TemplateCard({
  icon,
  title,
  desc,
  badge,
  hint,
  busy,
  onClick,
}: {
  icon: string;
  title: string;
  desc: string;
  badge?: string;
  hint?: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        textAlign: 'left',
        padding: 16,
        borderRadius: 12,
        border: '1px solid var(--border, #333)',
        background: 'var(--surface, #1a1a1a)',
        color: 'inherit',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.6 : 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 120,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        {badge && (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--surface-2, #222)', color: 'var(--text-muted, #9ca3af)', fontWeight: 600 }}>
            {badge}
          </span>
        )}
      </div>
      <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)', flex: 1 }}>{desc}</span>
      {hint && <span style={{ fontSize: 11, color: 'var(--success-text, #4ade80)' }}>✓ {hint}</span>}
    </button>
  );
}
