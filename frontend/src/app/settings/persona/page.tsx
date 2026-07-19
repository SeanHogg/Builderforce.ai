'use client';

/**
 * /settings/persona — the lens-persona settings surface. Standalone route (a new
 * file) so it works without editing the shared SettingsClient; the integration
 * note carries the one-line PillTab snippet to also surface it as a ?sub=persona
 * tab inside Settings.
 */

import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import PersonaSelector from '@/components/settings/PersonaSelector';

export default function PersonaSettingsPage() {
  const t = useTranslations('personaLens');
  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>{t('pageTitle')}</h1>
      <PersonaSelector />
    </PageContainer>
  );
}
