import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { SpawnDownloadButton } from './SpawnDownloadButton';
import styles from './spawn.module.css';

/**
 * The landing page's sections below the hero. Built to be looked at, not read:
 * each is a heading and a row of big icon tiles, and the only paragraphs on the
 * page sit behind a tap (the parents' note and the FAQ). Every list is a catalog
 * array, so adding a step or a question is a translation edit, never a code one.
 */

interface Tile { icon: string; label: string }
interface Faq { q: string; a: string }

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.h2}>{title}</h2>
      {children}
    </section>
  );
}

function Tiles({ tiles, numbered = false }: { tiles: Tile[]; numbered?: boolean }) {
  return (
    <ul className={styles.tiles}>
      {tiles.map((tile, i) => (
        <li key={tile.label} className={styles.tile}>
          {numbered && <span className={styles.stepNumber} aria-hidden>{i + 1}</span>}
          <span className={styles.tileIcon} aria-hidden>{tile.icon}</span>
          <span className={styles.tileLabel}>{tile.label}</span>
        </li>
      ))}
    </ul>
  );
}

export async function SpawnSteps() {
  const t = await getTranslations('spawn.steps');
  return (
    <Section id="how" title={t('title')}>
      <Tiles tiles={t.raw('items') as Tile[]} numbered />
    </Section>
  );
}

export async function SpawnSafety() {
  const t = await getTranslations('spawn.safety');
  return (
    <Section id="safety" title={t('title')}>
      <Tiles tiles={t.raw('badges') as Tile[]} />
      <details className={styles.faqItem}>
        <summary>{t('parentsTitle')}</summary>
        <p>{t('parents')}</p>
      </details>
    </Section>
  );
}

export async function SpawnFaq() {
  const t = await getTranslations('spawn.faq');
  const items = t.raw('items') as Faq[];
  return (
    <Section id="faq" title={t('title')}>
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

/** The last thing on the page is the first thing in the hero: the button. */
export async function SpawnGetStarted() {
  const t = await getTranslations('spawn.cta');
  return (
    <section id="download" className={styles.ctaBand} aria-labelledby="download-title">
      <h2 id="download-title" className={styles.h2}>{t('title')}</h2>
      <SpawnDownloadButton />
    </section>
  );
}
