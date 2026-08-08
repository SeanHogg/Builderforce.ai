import type { ReactNode } from 'react';
import { Badge as UiBadge, ButtonLink, Surface } from '@/components/ui';
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

/**
 * `eyebrow` names the STORY BEAT this section carries ("The problem", "What you
 * get"), not its ordinal. A running 01…08 down a page whose sections are not a
 * sequence is decoration that reads as structure, and it was the loudest signal
 * that this page was assembled rather than written.
 *
 * `aside` is for controls that belong with the heading rather than over the
 * content — a rail's prev/next, a filter.
 */
export function HomeSectionHeader({ title, lead, eyebrow, aside, centered = false }: {
  title: ReactNode;
  lead?: ReactNode;
  eyebrow?: ReactNode;
  aside?: ReactNode;
  centered?: boolean;
}) {
  return (
    <header className={centered ? styles.headerCentered : styles.header}>
      <div>{eyebrow && <span className={styles.eyebrow}>{eyebrow}</span>}<h2 className={styles.title}>{title}</h2></div>
      {(lead || aside) && (
        <div className={styles.headerAside}>
          {lead && <p className={styles.lead}>{lead}</p>}
          {aside}
        </div>
      )}
    </header>
  );
}

export function HomeGrid({ children, columns = 'auto' }: { children: ReactNode; columns?: 2 | 3 | 4 | 'auto' }) {
  const columnClass = columns === 2 ? styles.grid2 : columns === 3 ? styles.grid3 : columns === 4 ? styles.grid4 : styles.gridAuto;
  return <div className={`${styles.grid} ${columnClass}`}>{children}</div>;
}

export function HomeCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Surface padding="none" interactive className={`${styles.card} ${className}`}><article>{children}</article></Surface>;
}

export function CardIcon({ children }: { children: ReactNode }) { return <span className={styles.cardIcon} aria-hidden>{children}</span>; }
export function CardTitle({ children }: { children: ReactNode }) { return <h3 className={styles.cardTitle}>{children}</h3>; }
export function CardText({ children }: { children: ReactNode }) { return <p className={styles.cardText}>{children}</p>; }
export function BadgeRow({ children }: { children: ReactNode }) { return <div className={styles.badgeRow}>{children}</div>; }
export function Badge({ children, accent = false }: { children: ReactNode; accent?: boolean }) { return <UiBadge tone={accent ? 'accent' : 'neutral'}>{children}</UiBadge>; }

export function HomeButton({ href, children, primary = false, arrow = false }: { href: string; children: ReactNode; primary?: boolean; arrow?: boolean }) {
  return <ButtonLink href={href} variant={primary ? 'primary' : 'secondary'} size="lg">{children}{arrow && <Arrow />}</ButtonLink>;
}

function Arrow() {
  return <svg className={styles.arrow} viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export { styles as homePatternStyles };
