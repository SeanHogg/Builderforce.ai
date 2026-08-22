import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import ProsePage from '../ProsePage';
import { BRAND } from '@/lib/content';
import { pageMetadata } from '@/lib/seo';

export const runtime = 'edge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('agents.contact');
  return pageMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: '/agents/contact' });
}

/**
 * Where to reach the founder.
 *
 * `label` is a handle or a domain — a literal that must NOT be translated. `labelKey`
 * names a catalog entry for the links whose label is prose. `internal` marks a link
 * that stays on this site: the résumé is published HERE (see `BRAND.founder`), so it
 * navigates in place instead of opening a tab on another domain.
 */
const CONTACT_LINKS: { href: string; label?: string; labelKey?: string; internal?: boolean }[] = [
  { href: 'https://github.com/SeanHogg', label: 'github.com/SeanHogg' },
  { href: BRAND.founder.path, labelKey: 'resumeLabel', internal: true },
  { href: 'https://github.com/SeanHogg/Builderforce.ai/issues', labelKey: 'issuesLabel' },
  { href: 'https://instagram.com/CrawfishMellow', label: '@CrawfishMellow' },
];

export default async function ContactPage() {
  const t = await getTranslations('agents.contact');

  return (
    <ProsePage>
      <h1>{t('heading')}</h1>
      <p className="lead">{t('lead')}</p>

      <section>
        <h2>{BRAND.founder.name}</h2>
        <p>{t('founderRole')}</p>
        <ul>
          {CONTACT_LINKS.map((l) => {
            const label = l.labelKey ? t(l.labelKey) : l.label;
            return (
              <li key={l.href}>
                {l.internal
                  ? <Link href={l.href}>{label}</Link>
                  : <a href={l.href} target="_blank" rel="noopener">{label}</a>}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>{t('engageHeading')}</h2>
        <ul>
          <li>
            <a href="https://github.com/SeanHogg/Builderforce.ai" target="_blank" rel="noopener">{t('repoLabel')}</a>
            {' '}— {t('repoNote')}
          </li>
          <li>
            <a href="https://discord.gg/9gUsc2sNG6" target="_blank" rel="noopener">{t('discordLabel')}</a>
            {' '}— {t('discordNote')}
          </li>
          <li>
            <Link href="/agents/acknowledgements">{t('acknowledgementsLabel')}</Link>
            {' '}— {t('acknowledgementsNote')}
          </li>
        </ul>
      </section>
    </ProsePage>
  );
}
