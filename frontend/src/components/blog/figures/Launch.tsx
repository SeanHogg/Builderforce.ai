import type React from 'react';
import Link from 'next/link';
import styles from './figures.module.css';
import { hueOf, type LaunchFigure } from './types';

/** Deep links into the product a post is teaching. Site-relative only. */
/** Site-relative only — see `LaunchFigure`. */
const isInternalHref = (href: string): boolean => href.startsWith('/') && !href.startsWith('//');

export default function Launch({ spec }: { spec: LaunchFigure }) {
  const links = spec.links.filter((link) => isInternalHref(link.href));
  if (!links.length) return null;
  return (
    <ul className={styles.launch}>
      {links.map((link) => (
        <li key={link.href} className={styles.launchItem} style={{ '--hue': hueOf(link.hue) } as React.CSSProperties}>
          <Link href={link.href} className={styles.launchLink}>{link.label}</Link>
          {link.note && <span className={styles.launchNote}>{link.note}</span>}
        </li>
      ))}
    </ul>
  );
}
