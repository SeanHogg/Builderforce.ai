import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import JsonLd from '@/components/JsonLd';
import { pageMetadata } from '@/lib/seo';
import { routeMarketingSchema } from '@/lib/structured-data';
import { TUTORIAL_TOPICS, type TutorialTopicId } from '@/lib/tutorialCatalog';
import styles from './TutorialsPage.module.css';

export const runtime = 'edge';

type TopicCopy = { title: string; summary: string; agent: string; focus: string; outcomes: string[] };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tutorials.seo');
  return pageMetadata({ title: t('title'), description: t('description'), path: '/tutorials', ogTitle: t('ogTitle') });
}

export default async function TutorialsPage() {
  const t = await getTranslations('tutorials');
  const topics = t.raw('topics') as Record<TutorialTopicId, TopicCopy>;
  const steps = t.raw('steps') as Array<{ title: string; description: string }>;
  const courseHref = (topic: TopicCopy) => `/create/new?${new URLSearchParams({ prompt: t('coursePrompt', { topic: topic.title, focus: topic.focus, agent: topic.agent }) }).toString()}`;
  const customHref = `/create/new?${new URLSearchParams({ prompt: t('customPrompt') }).toString()}`;

  return (
    <>
      <JsonLd data={routeMarketingSchema({ path: '/tutorials', title: t('title'), description: t('lead') })} />
      <main className={styles.page}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>{t('eyebrow')}</p>
          <h1>{t('title')}</h1>
          <p className={styles.heroLead}>{t('lead')}</p>
        </section>
        <section className={styles.process} aria-label={t('howItWorks')}>
          {steps.map((step, index) => <article key={step.title}><span aria-hidden="true">{index + 1}</span><strong>{step.title}</strong><p>{step.description}</p></article>)}
        </section>
        <section className={styles.catalog}>
          <div className={styles.sectionHead}><h2>{t('catalogTitle')}</h2><p>{t('catalogLead')}</p></div>
          <div className={styles.grid}>
            {TUTORIAL_TOPICS.map((definition) => {
              const topic = topics[definition.id];
              return (
                <Link key={definition.id} href={courseHref(topic)} className={styles.card} style={{ '--topic-accent': definition.accent } as CSSProperties}>
                  <div className={styles.cardTop}><span className={styles.icon} aria-hidden="true">{definition.icon}</span><span className={styles.agent}>{t('teacherLabel', { agent: topic.agent })}</span></div>
                  <h3>{topic.title}</h3><p className={styles.summary}>{topic.summary}</p>
                  <ul className={styles.outcomes}>{topic.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}</ul>
                  <span className={styles.start}><span>{t('startCourse')}</span><span aria-hidden="true">→</span></span>
                </Link>
              );
            })}
          </div>
        </section>
        <section className={styles.custom}>
          <div><h2>{t('customTitle')}</h2><p>{t('customLead')}</p></div>
          <Link href={customHref}>{t('customCta')}</Link>
        </section>
      </main>
    </>
  );
}
