import type { CSSProperties } from 'react';
import { getTranslations } from 'next-intl/server';
import { publicResumesApi } from '@/lib/publicResumeApi';
import { activeResumeRevision, resumeFamilyFromNode } from '@/lib/canvasResume';
import { RESUME_DOCUMENT_STYLES, renderCanvasResumeRevision, resumePageCss } from '@/lib/canvasResumeRenderer';

export async function PublicResumeView({ token, embedded = false }: { token: string; embedded?: boolean }) {
  const t = await getTranslations('publicResume');
  const response = await publicResumesApi.get(token).catch(() => null);
  // The DOCUMENT keeps its own palette — a résumé is paper, and its template's
  // accent/paper/ink are the author's choice (see canvasResume.ts). Everything AROUND
  // it is our UI, so the desk it sits on, its ink and its shadow are tokens and follow
  // the viewer's theme. Embedded, there is no desk at all: the host page supplies it.
  const surround: CSSProperties = embedded
    ? { padding: 0, background: 'transparent' }
    : { padding: 24, background: 'var(--bg-base)' };
  const unavailable = <main role="alert" className="ui-text-body" style={{ padding: 32, color: 'var(--text-primary)', background: 'var(--bg-base)', minHeight: '100vh' }}>{t('unavailable')}</main>;
  if (!response) return unavailable;
  const family = resumeFamilyFromNode({ kind: 'resume', title: response.resume.title, resumeFamily: response.resume.resumeFamily });
  if (!family) return unavailable;
  const rendered = renderCanvasResumeRevision({ ...activeResumeRevision(family), templateId: family.defaultTemplateId });
  return <main style={{ minHeight: '100vh', overflow: 'auto', ...surround }}>
    <style>{`${resumePageCss(rendered.revision)}${RESUME_DOCUMENT_STYLES}`}</style>
    <div style={{ margin: '0 auto', maxWidth: '100%', boxShadow: embedded ? 'none' : 'var(--shadow-lg)' }} dangerouslySetInnerHTML={{ __html: rendered.html }} />
  </main>;
}
