import { getTranslations } from 'next-intl/server';
import { publicResumesApi } from '@/lib/publicResumeApi';
import { resumeFamilyFromNode } from '@/lib/canvasResume';
import { ResumeDocumentView } from './ResumeDocumentView';

export async function PublicResumeView({ token, embedded = false }: { token: string; embedded?: boolean }) {
  const t = await getTranslations('publicResume');
  const response = await publicResumesApi.get(token).catch(() => null);
  const unavailable = <main role="alert" className="ui-text-body" style={{ padding: 32, color: 'var(--text-primary)', background: 'var(--bg-base)', minHeight: '100vh' }}>{t('unavailable')}</main>;
  if (!response) return unavailable;
  const family = resumeFamilyFromNode({ kind: 'resume', title: response.resume.title, resumeFamily: response.resume.resumeFamily });
  if (!family) return unavailable;
  // The document keeps its own palette; the desk it sits on follows the viewer's theme.
  // Embedded there is no desk at all — the host page supplies the surface.
  return <main style={{ minHeight: '100vh', overflow: 'auto', padding: embedded ? 0 : 24, background: embedded ? 'transparent' : 'var(--bg-base)' }}>
    <ResumeDocumentView family={family} framed={false} />
  </main>;
}
