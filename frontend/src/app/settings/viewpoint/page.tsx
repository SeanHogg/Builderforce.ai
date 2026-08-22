/**
 * /settings/viewpoint — the insight-lens setting: which role's view of the
 * dashboards you get (CEO / CFO / CTO / CISO / PMO / EM).
 *
 * IT WAS CALLED "PERSONA", one index row away from Settings' "Personality" —
 * the user's psychometric profile. Two unrelated things, near-homographs, side
 * by side; PRD 21 §7 decision 1 asked for one of them to be renamed and the
 * operator renamed this one. "Personality" keeps its name because it is the
 * user's own profile and matches the runtime traits already shipped.
 *
 * The old `/settings/persona` URL still resolves — see the redirect beside this
 * file. A rename that breaks every link anyone ever shared is not a rename.
 *
 * A server component: only <PersonaSelector> is interactive, so the heading is
 * translated on the server and arrives in the visitor's locale on first paint.
 */
import { getTranslations } from 'next-intl/server';
import PageContainer from '@/components/PageContainer';
import PersonaSelector from '@/components/settings/PersonaSelector';

// getTranslations reads the locale cookie, which makes the route per-request.
export const runtime = 'edge';

export default async function ViewpointSettingsPage() {
  const t = await getTranslations('personaLens');
  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 20 }}>{t('pageTitle')}</h1>
      <PersonaSelector />
    </PageContainer>
  );
}
