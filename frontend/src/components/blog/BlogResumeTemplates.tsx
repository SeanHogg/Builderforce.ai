'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { canvasIntentHref } from '@/lib/canvasIntent';
import { RESUME_TEMPLATES } from '@/lib/canvasResume';
import styles from './BlogResumeTemplates.module.css';

/**
 * The résumé-template card a post embeds inline.
 *
 * The ported hired.video posts carried `previewTemplateIds` and rendered a
 * SCALED CARD of each template they recommended — the whole point of a post
 * titled "the best template for X" is showing the layout, not describing it.
 * The port dropped the embeds because the markdown pipeline had no fence for
 * them; this is that fence's renderer.
 *
 * It draws a real miniature from the SAME registry the editor and the tool
 * pages read (`RESUME_TEMPLATES`), so a template whose accent, column count,
 * sidebar or density changes changes here too — there is no second description
 * of a template anywhere. Nothing is a bitmap: the miniature is CSS over the
 * registry's own fields, so it stays sharp at any zoom and needs no fixture.
 *
 * Split into its own file and loaded with `next/dynamic` by `BlogFigure`,
 * because `canvasResume` drags the whole canvas contract in and 100+ of the 125
 * posts embed no template at all.
 */

/** A template's paper is always light — it is a printed page, in both themes. */
const LINE_WIDTHS = ['92%', '76%', '84%', '61%'];

function Miniature({ template }: { template: (typeof RESUME_TEMPLATES)[number] }) {
  const rows = template.density === 'compact' ? 5 : template.density === 'spacious' ? 3 : 4;
  const body = (
    <div className={styles.column}>
      {Array.from({ length: rows }).map((_, section) => (
        <div key={section} className={styles.section}>
          <span className={styles.heading} data-style={template.headingStyle} />
          {LINE_WIDTHS.slice(0, template.density === 'compact' ? 4 : 3).map((width, line) => (
            <span key={line} className={styles.line} style={{ width }} />
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <div
      className={styles.paper}
      data-mode={template.mode}
      style={{
        '--paper': template.paper,
        '--ink': template.ink,
        '--accent': template.accent,
        '--face': template.font === 'serif' ? 'var(--font-serif, Georgia, serif)'
          : template.font === 'mono' ? 'var(--font-mono, ui-monospace, monospace)'
            : 'var(--font-sans, system-ui, sans-serif)',
      } as React.CSSProperties}
      aria-hidden="true"
    >
      {template.mode === 'hero' && <div className={styles.hero}><span className={styles.avatar} /><span className={styles.heroLines}><span /><span /></span></div>}
      <div className={styles.body} data-columns={template.columns}>
        {template.columns === 2 && (
          <div className={styles.sidebar}>
            {(template.sidebar.length ? template.sidebar : ['skills', 'education']).map((section) => (
              <div key={section} className={styles.section}>
                <span className={styles.heading} data-style={template.headingStyle} />
                <span className={styles.line} style={{ width: '84%' }} />
                <span className={styles.line} style={{ width: '66%' }} />
              </div>
            ))}
          </div>
        )}
        {body}
      </div>
    </div>
  );
}

export default function BlogResumeTemplates({ templateIds }: { templateIds: readonly string[] }) {
  const t = useTranslations('blogFigure');
  const label = useTranslations('creationCanvas.resumeEditor');
  const templates = templateIds
    .map((id) => RESUME_TEMPLATES.find((template) => template.id === id))
    .filter((template): template is (typeof RESUME_TEMPLATES)[number] => !!template);
  if (!templates.length) return null;
  return (
    <ul className={styles.grid}>
      {templates.map((template) => (
        <li key={template.id} className={styles.card}>
          <Miniature template={template} />
          <div className={styles.meta}>
            <strong className={styles.name}>{label(template.labelKey)}</strong>
            <span className={styles.industry}>{template.industry}</span>
            <span className={styles.spec}>
              {t(`columns_${template.columns}`)} · {t(`density_${template.density}`)} · {t(`font_${template.font}`)}
            </span>
            {/* The real canvas entry point: `/create/new` seeds a board from a
                prompt (`canvasIntentHref`) and takes no template parameter, so
                the link names the template in the prompt rather than inventing
                a query string nothing reads. */}
            <Link className={styles.cta} href={canvasIntentHref(t('templatePrompt', { template: label(template.labelKey), industry: template.industry }))}>
              {t('useTemplate')}
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
