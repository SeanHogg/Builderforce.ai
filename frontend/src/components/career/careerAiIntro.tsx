/**
 * The standing footnote under every résumé-AI tab.
 *
 * It exists because the single most damaging thing an AI résumé tool can do is put a
 * number on somebody's document that they cannot defend in a room — and a person cannot
 * evaluate a guarantee they were never told about. Every rewrite and every merge on this
 * page has already been checked against the source document and discarded if it asserted
 * a figure the résumé does not contain, so the page says so, once, where it is read
 * rather than in a docblock only the author sees.
 */

import { useTranslations } from 'next-intl';
import { Surface } from '@/components/ui';

export function ResumeReviewNote() {
  const t = useTranslations('careerAi');
  return (
    <Surface tone="sunken" padding="md">
      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', maxWidth: '75ch' }}>
        {t('guarantee')}
      </p>
    </Surface>
  );
}
