import { useTranslations } from 'next-intl';
import styles from '../CreationCanvas.module.css';
import { canvasSlides } from '@/lib/canvasDocuments';
import type { CreationBodyProps } from './types';
import { AuthoredContent, textValue } from './shared';

/** A deck rendered as slides. Authored slide items win; a deck written as
 * markdown is split on rules, then on headings. */
export function SlidesBody({ data }: CreationBodyProps) {
  const t = useTranslations('creationCanvas.node');
  const slides = canvasSlides(data);
  if (!slides.length) return <AuthoredContent data={data} fallback={t('slidesFallback')} />;
  return <div className={styles.slidesBody}>
    <div className={styles.documentMeta}>
      <span>{t('slideCount', { count: slides.length })}</span>
      <span>{textValue(data.outputFormat, 'PPTX')}</span>
    </div>
    <div className={`${styles.slideDeck} nowheel nodrag`} role="region" aria-label={data.title} tabIndex={0}>
      {slides.map((slide, index) => <article key={`${slide.title}-${index}`} className={styles.slideThumb}>
        <span className={styles.slideNumber}>{index + 1}</span>
        <b>{slide.title || t('slideUntitled', { index: index + 1 })}</b>
        {!!slide.bullets.length && <ul>{slide.bullets.slice(0, 5).map((bullet, bulletIndex) => <li key={`${bullet}-${bulletIndex}`}>{bullet}</li>)}</ul>}
      </article>)}
    </div>
  </div>;
}
