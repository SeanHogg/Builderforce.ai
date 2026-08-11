import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui';

export function ProjectManagerVisual({ variant }: { variant: 'projects' | 'manager' }) {
  const t = useTranslations(`routeMarketing.${variant}.visual`);

  if (variant === 'manager') {
    return (
      <div className="rm-product-visual rm-manager-visual" role="img" aria-label={t('aria')}>
        <div className="rm-visual-bar">
          <span className="rm-visual-brand"><Icon source="brain" size={17} />{t('title')}</span>
          <span className="rm-live"><span />{t('live')}</span>
        </div>
        <div className="rm-manager-score">
          <div><span className="rm-score-number">84</span><span className="rm-score-unit">/100</span></div>
          <div><strong>{t('deliveryHealth')}</strong><span>{t('healthChange')}</span></div>
        </div>
        <div className="rm-manager-grid">
          <div className="rm-mini-card"><Icon source="target" size={16} /><strong>{t('prioritized')}</strong><span>12</span></div>
          <div className="rm-mini-card"><Icon source="warning" size={16} /><strong>{t('risks')}</strong><span>3</span></div>
          <div className="rm-mini-card"><Icon source="check" size={16} /><strong>{t('decisions')}</strong><span>27</span></div>
        </div>
        <div className="rm-decision">
          <span className="rm-decision-icon"><Icon source="sparkles" size={15} /></span>
          <div><strong>{t('decisionTitle')}</strong><span>{t('decisionBody')}</span></div>
          <span className="rm-now">{t('now')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rm-product-visual rm-project-visual" role="img" aria-label={t('aria')}>
      <div className="rm-visual-bar">
        <span className="rm-visual-brand"><Icon source="project" size={17} />{t('title')}</span>
        <span className="rm-team"><span>MA</span><span>RE</span><span>AI</span></span>
      </div>
      <div className="rm-board">
        {(['planned', 'progress', 'done'] as const).map((column, columnIndex) => (
          <div className="rm-board-column" key={column}>
            <div className="rm-column-title"><span>{t(column)}</span><b>{columnIndex === 0 ? 3 : 2}</b></div>
            <div className={`rm-task-card rm-task-${columnIndex + 1}`}>
              <span className="rm-task-kicker">{t(`${column}Kicker`)}</span>
              <strong>{t(`${column}Task`)}</strong>
              <span className="rm-task-meta"><i />{t(`${column}Owner`)}</span>
            </div>
            {columnIndex < 2 && <div className="rm-task-placeholder" />}
          </div>
        ))}
      </div>
    </div>
  );
}
