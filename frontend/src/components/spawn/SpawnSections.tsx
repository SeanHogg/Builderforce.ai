import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { SPAWN_DOWNLOAD_URL, SPAWN_POST_PATH } from '@/lib/spawn/spawnLinks';
import styles from './spawn.module.css';

/**
 * The landing page's explanatory sections. Each is presentational and reads only
 * its own slice of the `spawn` catalog, so the copy changes in the catalogs, never
 * here; the lists are catalog arrays, so adding a feature or a question is a
 * translation edit.
 */

interface Card { icon: string; title: string; body: string }
interface Faq { q: string; a: string }
interface CompareRow { label: string; spawn: boolean; typical: boolean }

function SectionHead({ id, eyebrow, title, lede }: { id: string; eyebrow: string; title: string; lede?: string }) {
  return (
    <div className={styles.sectionHead}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2 id={`${id}-title`} className={styles.h2}>{title}</h2>
      {lede && <p className={styles.lede}>{lede}</p>}
    </div>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  return <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>{children}</section>;
}

export async function SpawnHowItWorks() {
  const t = await getTranslations('spawn.how');
  const steps = t.raw('steps') as Card[];
  return (
    <Section id="how">
      <SectionHead id="how" eyebrow={t('eyebrow')} title={t('title')} lede={t('lede')} />
      <ol className={styles.grid} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {steps.map((step, i) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.stepNumber} aria-hidden>{i + 1}</span>
            <h3 className={styles.cardTitle}>{step.icon} {step.title}</h3>
            <p className={styles.cardBody}>{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export async function SpawnFeatures() {
  const t = await getTranslations('spawn.features');
  const cards = t.raw('cards') as Card[];
  return (
    <Section id="features">
      <SectionHead id="features" eyebrow={t('eyebrow')} title={t('title')} />
      <div className={styles.grid}>
        {cards.map((card) => (
          <article key={card.title} className={styles.card}>
            <span className={styles.cardIcon} aria-hidden>{card.icon}</span>
            <h3 className={styles.cardTitle}>{card.title}</h3>
            <p className={styles.cardBody}>{card.body}</p>
          </article>
        ))}
      </div>
    </Section>
  );
}

export async function SpawnCompare() {
  const t = await getTranslations('spawn.compare');
  const rows = t.raw('rows') as CompareRow[];
  const mark = (yes: boolean) => <span className={yes ? styles.yes : styles.no}>{yes ? t('yes') : t('no')}</span>;
  return (
    <Section id="compare">
      <SectionHead id="compare" eyebrow={t('eyebrow')} title={t('title')} lede={t('lede')} />
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th scope="col">{t('colWhat')}</th><th scope="col">Spawn</th><th scope="col">{t('colTypical')}</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}><th scope="row">{row.label}</th><td>{mark(row.spawn)}</td><td>{mark(row.typical)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export async function SpawnSafety() {
  const t = await getTranslations('spawn.safety');
  const cards = t.raw('cards') as Card[];
  return (
    <Section id="safety">
      <SectionHead id="safety" eyebrow={t('eyebrow')} title={t('title')} lede={t('lede')} />
      <div className={styles.grid}>
        {cards.map((card) => (
          <article key={card.title} className={styles.card}>
            <span className={styles.cardIcon} aria-hidden>{card.icon}</span>
            <h3 className={styles.cardTitle}>{card.title}</h3>
            <p className={styles.cardBody}>{card.body}</p>
          </article>
        ))}
      </div>
      <p className={styles.notice}>{t('parents')}</p>
    </Section>
  );
}

export async function SpawnDownload() {
  const t = await getTranslations('spawn.download');
  const points = t.raw('points') as string[];
  return (
    <Section id="download">
      <SectionHead id="download" eyebrow={t('eyebrow')} title={t('title')} lede={t('lede')} />
      <ul className={styles.cardBody} style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: '1rem' }}>
        {points.map((point) => <li key={point}>{point}</li>)}
      </ul>
      <div className={styles.ctaRow}>
        <a href={SPAWN_DOWNLOAD_URL} className={styles.cta} target="_blank" rel="noopener noreferrer">{t('button')}</a>
        <Link href={SPAWN_POST_PATH} className={styles.ctaGhost}>{t('readMore')}</Link>
      </div>
      <p className={styles.fine}>{t('requirements')}</p>
    </Section>
  );
}

export async function SpawnFaq() {
  const t = await getTranslations('spawn.faq');
  const items = t.raw('items') as Faq[];
  return (
    <Section id="faq">
      <SectionHead id="faq" eyebrow={t('eyebrow')} title={t('title')} />
      <div className={styles.faq}>
        {items.map((item) => (
          <details key={item.q} className={styles.faqItem}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
