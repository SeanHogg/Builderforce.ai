'use client';

import { useTranslations } from 'next-intl';
import type { VelocityRecommendation } from '@/types/velocity';

interface VelocityRecommendationsProps {
  recommendations: VelocityRecommendation[];
}

/**
 * Displays AI-generated recommendations for addressing velocity gaps
 */
export function VelocityRecommendations({
  recommendations,
}: VelocityRecommendationsProps) {
  const t = useTranslations('velocity');

  const priorityColors = {
    high: 'high-priority',
    medium: 'medium-priority',
    low: 'low-priority',
  };

  const actionTypeLabels: Record<VelocityRecommendation['actionType'], string> = {
    adjust_schedule: t('adjustSchedule'),
    hold_stories: t('holdStories'),
    split_stories: t('splitStories'),
    add_capacity: t('addCapacity'),
    reprioritize: t('reprioritize'),
    other: t('other'),
  };

  return (
    <div className="velocity-recommendations">
      <h2>{t('recommendationsTitle')}</h2>
      <p className="velocity-recommendations-subtitle">
        {t('recommendationsSubtitle')}
      </p>

      <div className="recommendations-container">
        {recommendations.length === 0 ? (
          <div className="velocity-no-recommendations">
            <p>{t('noRecommendations')}</p>
          </div>
        ) : (
          recommendations.map((rec) => (
            <div
              key={rec.id}
              className={`velocity-recommendation velocity-${rec.priority}`}
            >
              <div className="recommendation-header">
                <span className={`priority-badge ${priorityColors[rec.priority]}`}>
                  {rec.priority.toUpperCase()}
                </span>
                <h3>{rec.title}</h3>
              </div>

              <div className="recommendation-content">
                <p className="action-type">
                  {actionTypeLabels[rec.actionType]}
                </p>
                <p className="recommendation-description">
                  {rec.description}
                </p>

                <div className="recommendation-impact">
                  <h4>{t('estimatedImpact')}:</h4>
                  <p>{rec.effects.projected}</p>
                  <p className="impact-comparison">
                    <span className="comparison-label">{t('current')}</span>
                    <span className="comparison-value current">
                      {rec.effects.current}
                    </span>
                  </p>
                  <p className="impact-comparison">
                    <span className="comparison-label">{t('projected')}</span>
                    <span className="comparison-value projected">
                      {rec.effects.projected}
                    </span>
                  </p>
                </div>

                <div className="recommendation-change">
                  <span className="change-positive">
                    ↑ {rec.estimatedImpact} {t('pointsTowardsGap')}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}