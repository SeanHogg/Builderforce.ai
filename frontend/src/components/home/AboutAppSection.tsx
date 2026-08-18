// No `'use client'` directive on purpose: the sole importer is the homepage,
// which is already a client boundary, so the directive would change nothing
// except the architecture ratchet's count. Its siblings `HomePatterns` and
// `MarketingFaq` omit it for the same reason.
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  CardText,
  CardTitle,
  HomeCard,
  HomeGrid,
  HomeSection,
  HomeSectionHeader,
} from './HomePatterns';

type AboutPoint = { title: string; body: string };

/**
 * The plain-language "what this application is" band.
 *
 * It exists because the homepage's argument is a DEMONSTRATION — a board you can
 * type into — and a demonstration is not a description. Anyone who needs the
 * product stated rather than shown (a first-time visitor, a screen reader user
 * skimming headings, an OAuth verification reviewer checking that the app names
 * itself and says what it does) had nothing to read. It names the application,
 * says what it is for, says that it is usable without an account, and says which
 * connected-service permissions it asks for and why — the four things a visitor
 * has to take on trust otherwise.
 *
 * Built entirely from the shared home primitives: this band earns no styling of
 * its own, so it gets none.
 */
export function AboutAppSection() {
  const t = useTranslations('home.about');
  const points = t.raw('points') as AboutPoint[];

  return (
    <HomeSection id="about" tone="soft">
      <HomeSectionHeader eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
      <HomeGrid columns={3}>
        {points.map((point) => (
          <HomeCard key={point.title}>
            <CardTitle>{point.title}</CardTitle>
            <CardText>{point.body}</CardText>
          </HomeCard>
        ))}
      </HomeGrid>
      <p style={{ marginTop: 'var(--space-5)', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
        {t('dataNote')}{' '}
        <Link href="/legal/privacy" style={{ color: 'var(--accent)' }}>{t('privacyLink')}</Link>
        {' · '}
        <Link href="/legal/terms" style={{ color: 'var(--accent)' }}>{t('termsLink')}</Link>
      </p>
    </HomeSection>
  );
}
