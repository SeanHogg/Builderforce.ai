'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { VelocityAction } from '@/types/velocity';

interface VelocityActionPlanProps {
  actions: VelocityAction[];
  onCompleteAction?: (actionId: string) => void;
}

/**
 * Displays action plan with milestones for addressing velocity gaps
 */
export function VelocityActionPlan({
  actions,
  onCompleteAction,
}: VelocityActionPlanProps) {
  const t = useTranslations('velocity');

  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());

  const statusLabels: Record<VelocityAction['status'], string> = {
    planned: t('planned'),
    in_progress: t('inProgress'),
    completed: t('completed'),
  };

  const priorityColors: Record<VelocityAction['priority'], string> = {
    high: 'high-priority',
    medium: 'medium-priority',
    low: 'low-priority',
  };

  const toggleExpand = (actionId: string) => {
    setExpandedActions(prev => {
      const next = new Set(prev);
      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }
      return next;
    });
  };

  const handleComplete = (actionId: string) => {
    if (onCompleteAction) {
      onCompleteAction(actionId);
    }
  };

  const completedActions = actions.filter(a => a.status === 'completed');
  const inProgressActions = actions.filter(a => a.status === 'in_progress');
  const pendingActions = actions.filter(a => a.status === 'planned');

  return (
    <div className="velocity-action-plan">
      <h2>{t('actionPlanTitle')}</h2>
      <p className="action-plan-subtitle">
        {t('actionPlanSubtitle')}
      </p>

      {/* Progress Overview */}
      <div className="action-plan-progress">
        <div className="progress-section">
          <h3>{t('overallProgress')}</h3>
          <div className="progress-bar">
            <div
              className={`progress-fill fill-${actions.length > 0 ? Math.round((completedActions.length / actions.length) * 100) : 0}%`}
            />
          </div>
          <div className="progress-text">
            <span className="progress-number">
              {completedActions.length}/{actions.length}
            </span>
            <span className="progress-label">{t('actionsCompleted')}</span>
          </div>
        </div>
      </div>

      {/* Action List */}
      <div className="actions-container">
        {actions.length === 0 ? (
          <div className="no-actions">
            <p>{t('noActions')}</p>
          </div>
        ) : (
          <>
            {/* Completed Actions */}
            {completedActions.length > 0 && (
              <div className="action-category">
                <h4 className="category-header completed">
                  {t('completed')}
                </h4>
                {completedActions.map((action) => (
                  <div key={action.id} className="action-item completed">
                    <div className="action-item-header">
                      <span className={`priority-badge ${priorityColors[action.priority]}`}>
                        {action.priority.toUpperCase()}
                      </span>
                      <h4>{action.title}</h4>
                    </div>
                    <div className="action-item-details">
                      <p className="action-description">{action.description}</p>
                      <p className="action-status">✓ {t('completed')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* In Progress Actions */}
            {inProgressActions.length > 0 && (
              <div className="action-category">
                <h4 className="category-header in-progress">
                  {t('inProgress')}
                </h4>
                {inProgressActions.map((action) => (
                  <div key={action.id} className="action-item in-progress">
                    <div className="action-item-header">
                      <span className={`priority-badge ${priorityColors[action.priority]}`}>
                        {action.priority.toUpperCase()}
                      </span>
                      <h4>{action.title}</h4>
                    </div>
                    <button
                      className="complete-button"
                      onClick={() => handleComplete(action.id)}
                    >
                      {t('markComplete')}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Pending Actions */}
            {pendingActions.length > 0 && (
              <div className="action-category">
                <h4 className="category-header pending">
                  {t('pending')}
                </h4>
                {pendingActions.map((action) => (
                  <div
                    key={action.id}
                    className={`action-item ${expandedActions.has(action.id) ? 'expanded' : ''}`}
                  >
                    <div
                      className="action-item-header"
                      onClick={() => toggleExpand(action.id)}
                    >
                      <span className={`priority-badge ${priorityColors[action.priority]}`}>
                        {action.priority.toUpperCase()}
                      </span>
                      <h4>{action.title}</h4>
                      <span className="expand-icon">
                        {expandedActions.has(action.id) ? '▼' : '▶'}
                      </span>
                    </div>
                    {expandedActions.has(action.id) && (
                      <div className="action-item-details">
                        <p className="action-description">{action.description}</p>
                        <div className="action-meta">
                          <p>
                            <strong>{t('estimatedCompletion')}:</strong> {action.estimatedCompletion}
                          </p>
                          {action.owner && (
                            <p>
                              <strong>{t('owner')}:</strong> {action.owner}
                            </p>
                          )}
                          <p>
                            <strong>{t('estimatedSprints')}:</strong> {action.estimatedSprintsToComplete}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}