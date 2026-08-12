import { getTranslations } from 'next-intl/server';
import { publicResumesApi } from '@/lib/publicResumeApi';
import { activeResumeRevision, resumeFamilyFromNode } from '@/lib/canvasResume';
import { RESUME_DOCUMENT_STYLES, renderCanvasResumeRevision, resumePageCss } from '@/lib/canvasResumeRenderer';

export async function PublicResumeView({ token, embedded = false }: { token: string; embedded?: boolean }) {
  const t = await getTranslations('publicResume');
  const response = await publicResumesApi.get(token).catch(() => null);
  if (!response) return <main role="alert" style={{ padding: 32, font: '16px system-ui' }}>{t('unavailable')}</main>;
  const family = resumeFamilyFromNode({ kind: 'resume', title: response.resume.title, resumeFamily: response.resume.resumeFamily });
  if (!family) return <main role="alert" style={{ padding: 32, font: '16px system-ui' }}>{t('unavailable')}</main>;
  const rendered = renderCanvasResumeRevision({ ...activeResumeRevision(family), templateId: family.defaultTemplateId });
  return <main style={{ minHeight: '100vh', padding: embedded ? 0 : 24, background: embedded ? '#fff' : '#eef1f6', overflow: 'auto' }}>
    <style>{`${resumePageCss(rendered.revision)}${RESUME_DOCUMENT_STYLES}`}</style>
    <div style={{ margin: '0 auto', boxShadow: embedded ? 'none' : '0 12px 40px rgba(15,23,42,.16)' }} dangerouslySetInnerHTML={{ __html: rendered.html }} />
  </main>;
}
