'use client';

/**
 * Velocity Gap Module Integration
 *
 * This module provides the complete velocity gap tracking and analysis functionality.
 * It combines the dashboard, recommendations, and action plan components into a
 * cohesive user experience.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { VelocityGapDashboard } from './VelocityGapDashboard';
import { VelocityRecommendations } from './VelocityRecommendations';
import { VelocityActionPlan } from './VelocityActionPlan';
import type { VelocityAction } from '@/types/velocity';

interface VelocityModuleProps {
  projectId: number;
  initialContext?: {
    gapResult?: any;
    recommendations?: any[];
    actions?: VelocityAction[];
  };
}

/**
 * Main Velocity Gap Module - entry point for velocity analysis
 */
export function VelocityModule({ projectId, initialContext }: VelocityModuleProps) {
  const t = useTranslations('velocity');
  const [displayMode, setDisplayMode] = useState<'dashboard' | 'recommendations' | 'actions'>('dashboard');
  const [recommendations, setRecommendations] = useState<any[]>(
    initialContext?.recommendations || []
  );
  const [actions, setActions] = useState<VelocityAction[]>(
    initialContext?.actions || []
  );

  const handleCompleteAction = (actionId: string) => {
    alert(`Action ${actionId} marked as complete!`);
    // TODO: Implement actual action completion
  };

  return (
    <div className="velocity-module">
      <VelocityGapDashboard projectId={projectId} />

      {/* Tab Navigation */}
      <div className="velocity-tabs">
        <button
          className={`velocity-tab ${displayMode === 'dashboard' ? 'active' : ''}`}
          onClick={() => setDisplayMode('dashboard')}
        >
          {t('dashboardTitle')}
        </button>
        <button
          className={`velocity-tab ${displayMode === 'recommendations' ? 'active' : ''}`}
          onClick={() => setDisplayMode('recommendations')}
          disabled={recommendations.length === 0}
        >
          {t('recommendationsButton')}
        </button>
        <button
          className={`velocity-tab ${displayMode === 'actions' ? 'active' : ''}`}
          onClick={() => setDisplayMode('actions')}
          disabled={actions.length === 0}
        >
          {t('actionPlanButton')}
        </button>
      </div>

      {/* Dynamic Content */}
      <div className="velocity-content">
        {displayMode === 'dashboard' && (
          <VelocityGapDashboard projectId={projectId} />
        )}

        {displayMode === 'recommendations' && recommendations.length > 0 && (
          <VelocityRecommendations recommendations={recommendations} />
        )}

        {displayMode === 'actions' && actions.length > 0 && (
          <VelocityActionPlan
            actions={actions}
            onCompleteAction={handleCompleteAction}
          />
        )}

        {displayMode !== 'dashboard' && recommendations.length === 0 && (
          <p className="velocity-no-data">{t('noRecommendations')}</p>
        )}

        {displayMode !== 'dashboard' && actions.length === 0 && (
          <p className="velocity-no-data">{t('noActions')}</p>
        )}
      </div>
    </div>
  );
}

export {
  VelocityGapDashboard,
  VelocityRecommendations,
  VelocityActionPlan,
};