import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './HomePatterns.module.css';

export function HomeSection({ children, id, tone = 'plain', narrow = false }: {
  children: ReactNode;
  id?: string;
  tone?: 'plain' | 'soft' | 'grid';
  narrow?: boolean;
}) {
  const toneClass = tone === 'soft' ? styles.sectionSoft : tone === 'grid' ? styles.sectionGrid : '';
  return <section className={`${styles.section} ${toneClass}`} id={id}><div className={`${styles.inner} ${narrow ? styles.innerNarrow : ''}`}>{children}</div></section>;
}

export function HomeSectionHeader({ title, lead, eyebrow, centered = false }: {
  title: ReactNode;
  lead?: ReactNode;
  eyebrow?: ReactNode;
  centered?: boolean;
}) {
  return (
    <header className={centered ? styles.headerCentered : styles.header}>
      <div>{eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}<h2 className={styles.title}>{title}</h2></div>
      {lead && <p className={styles.lead}>{lead}</p>}
    </header>
  );
}

export function HomeGrid({ children, columns = 'auto' }: { children: ReactNode; columns?: 2 | 3 | 4 | 'auto' }) {
  const columnClass = columns === 2 ? styles.grid2 : columns === 3 ? styles.grid3 : columns === 4 ? styles.grid4 : styles.gridAuto;
  return <div className={`${styles.grid} ${columnClass}`}>{children}</div>;
}

export function HomeCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <article className={`${styles.card} ${className}`}>{children}</article>;
}

export function CardIcon({ children }: { children: ReactNode }) { return <span className={styles.cardIcon} aria-hidden>{children}</span>; }
export function CardTitle({ children }: { children: ReactNode }) { return <h3 className={styles.cardTitle}>{children}</h3>; }
export function CardText({ children }: { children: ReactNode }) { return <p className={styles.cardText}>{children}</p>; }
export function BadgeRow({ children }: { children: ReactNode }) { return <div className={styles.badgeRow}>{children}</div>; }
export function Badge({ children, accent = false }: { children: ReactNode; accent?: boolean }) { return <span className={`${styles.badge} ${accent ? styles.badgeAccent : ''}`}>{children}</span>; }

export function HomeButton({ href, children, primary = false, arrow = false }: { href: string; children: ReactNode; primary?: boolean; arrow?: boolean }) {
  return <Link href={href} className={`${styles.button} ${primary ? styles.buttonPrimary : ''}`}>{children}{arrow && <Arrow />}</Link>;
}

function Arrow() {
  return <svg className={styles.arrow} viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export { styles as homePatternStyles };
