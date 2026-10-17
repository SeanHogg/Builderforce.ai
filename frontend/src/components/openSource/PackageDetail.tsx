import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import RelatedArticles from '@/components/blog/RelatedArticles';
import { CreationCtaSection } from '@/components/marketing/CreationCtaSection';
import { packageRegistryUrl, type OpenSourcePackage } from '@/lib/openSourcePackages';
import { openSourcePackageSchema } from '@/lib/openSourceSchema';
import CodeSnippet from './CodeSnippet';
import PackageComparison from './PackageComparison';
import styles from './openSource.module.css';

/**
 * `/open-source/<slug>` — one package: the problem it solves, what you get, how
 * it compares to the closed alternative (where there is one), how to start, how
 * Builderforce runs it, and where to go next.
 *
 * Copy is `openSource.packages.<key>.*`; facts, code and URLs are the registry
 * row. The related article is THE `RelatedArticles` card, which resolves the
 * slug against the blog index and renders nothing for a renamed or unpublished
 * post, so it can never leave a dead link here. The closing ask is THE
 * marketing `CreationCtaSection`.
 */
export default async function PackageDetail({ entry }: { entry: OpenSourcePackage }) {
  const root = await getTranslations();
  const t = await getTranslations('openSource');
  const copy = `packages.${entry.key}`;
  const gets = (t.raw(`${copy}.gets`) as string[] | undefined) ?? [];
  const registryLinks = entry.packages
    .map((name) => ({ name, href: packageRegistryUrl(entry, name) }))
    .filter((link): link is { name: string; href: string } => Boolean(link.href));

  return (
    <main className={styles.page}>
      <JsonLd data={openSourcePackageSchema(root, entry)} />
      <header className={styles.hero}>
        <p className={styles.eyebrow}>{t('detail.eyebrow')}</p>
        <h1 className={styles.title}>{entry.displayName}</h1>
        <p className={styles.lede}>{t(`${copy}.tagline`)}</p>
        <p className={styles.heroSummary}>{t(`${copy}.summary`)}</p>
        <div className={styles.ctaActions}>
          <a className={styles.btnPrimary} href={entry.repoUrl} target="_blank" rel="noopener noreferrer">
            {t('detail.source')}
          </a>
          <Link className={styles.btnSecondary} href="/open-source">{t('detail.back')}</Link>
        </div>
      </header>

      <section className={styles.band} aria-labelledby="os-problem">
        <h2 id="os-problem" className={styles.sectionTitle}>{t('detail.problemTitle')}</h2>
        <p className={styles.body}>{t(`${copy}.problem`)}</p>
      </section>

      <section className={styles.band} aria-labelledby="os-gets">
        <h2 id="os-gets" className={styles.sectionTitle}>{t('detail.getsTitle')}</h2>
        <ul className={styles.list}>
          {gets.map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className={styles.note}>
          <strong>{t('detail.statusLabel')}</strong> {t(`${copy}.status`)}
        </p>
      </section>

      <PackageComparison entry={entry} />

      <section className={styles.band} aria-labelledby="os-start">
        <h2 id="os-start" className={styles.sectionTitle}>{t('detail.quickStartTitle')}</h2>
        <p className={styles.body}>{t(`${copy}.quickStartNote`)}</p>
        <CodeSnippet label={entry.quickStartLanguage} code={entry.quickStart} />
      </section>

      <section className={styles.band} aria-labelledby="os-usage">
        <h2 id="os-usage" className={styles.sectionTitle}>{t('detail.usageTitle')}</h2>
        <p className={styles.body}>{t(`${copy}.usage`)}</p>
      </section>

      <section className={styles.band} aria-labelledby="os-links">
        <h2 id="os-links" className={styles.sectionTitle}>{t('detail.linksTitle')}</h2>
        <dl className={styles.facts}>
          <dt>{t('card.license')}</dt>
          <dd>{entry.license} · {t('detail.licenseNote')}</dd>
          <dt>{t('detail.repository')}</dt>
          <dd>
            <a className={styles.textLink} href={entry.repoUrl} target="_blank" rel="noopener noreferrer">{entry.repoUrl}</a>
          </dd>
          <dt>{t('card.packages')}</dt>
          <dd>
            {registryLinks.length > 0
              ? registryLinks.map((link, i) => (
                <span key={link.name}>
                  {i > 0 ? ', ' : null}
                  <a className={styles.textLink} href={link.href} target="_blank" rel="noopener noreferrer">{link.name}</a>
                </span>
              ))
              : `${entry.packages.join(', ')} · ${t('detail.fromSource')}`}
          </dd>
        </dl>
      </section>

      {entry.relatedBlogSlug ? (
        <RelatedArticles slugs={[entry.relatedBlogSlug]} heading={t('detail.blog')} limit={1} />
      ) : null}

      <CreationCtaSection />
    </main>
  );
}
