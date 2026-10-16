import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BLOG_POSTS } from '@/lib/blogData';
import { packageRegistryUrl, type OpenSourcePackage } from '@/lib/openSourcePackages';
import CodeSnippet from './CodeSnippet';
import PackageComparison from './PackageComparison';
import styles from './openSource.module.css';

/**
 * `/open-source/<slug>` — one package: the problem it solves, what you get, how
 * it compares to the closed alternative (where there is one), how to start, how
 * Builderforce runs it, and where to go next.
 *
 * Copy is `openSource.packages.<key>.*`; facts, code and URLs are the registry
 * row. The related article is linked only while it is actually in the blog
 * index, so a renamed or unpublished post can never leave a dead link here.
 */
export default async function PackageDetail({ entry }: { entry: OpenSourcePackage }) {
  const t = await getTranslations('openSource');
  const copy = `packages.${entry.key}`;
  const gets = (t.raw(`${copy}.gets`) as string[] | undefined) ?? [];
  const blog = entry.relatedBlogSlug ? BLOG_POSTS.find((post) => post.slug === entry.relatedBlogSlug) : undefined;
  const registryLinks = entry.packages
    .map((name) => ({ name, href: packageRegistryUrl(entry, name) }))
    .filter((link): link is { name: string; href: string } => Boolean(link.href));

  return (
    <main className={styles.page}>
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
          {blog ? (
            <>
              <dt>{t('detail.blog')}</dt>
              <dd>
                <Link className={styles.textLink} href={`/blog/${blog.slug}`}>{blog.title}</Link>
              </dd>
            </>
          ) : null}
        </dl>
      </section>

      <section className={styles.cta}>
        <div className={styles.ctaBox}>
          <h2 className={styles.sectionTitle}>{t('cta.title')}</h2>
          <p className={styles.body}>{t('cta.desc')}</p>
          <div className={styles.ctaActions}>
            <Link className={styles.btnPrimary} href="/create/new">{t('cta.primary')}</Link>
            <Link className={styles.btnSecondary} href="/open-source">{t('detail.back')}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
