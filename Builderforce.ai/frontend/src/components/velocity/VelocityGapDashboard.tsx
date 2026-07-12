'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  calculateVelocityGap,
  getCurrentVelocity,
  getRequiredVelocity,
  getVelocityChartData,
} from '@/lib/velocityApi';
import type {
  VelocityGapResult,
  CurrentVelocity,
  RequiredVelocity,
  VelocityChartSeries,
} from '@/types/velocity';

/**
 * Displays the main velocity gap analysis dashboard
 */
export function VelocityGapDashboard({ projectId }: { projectId: number }) {
  const t = useTranslations('velocity');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [gapResult, setGapResult] = useState<VelocityGapResult | null>(null);
  const [currentVelocity, setCurrentVelocity] = useState<CurrentVelocity | null>(null);
  const [requiredVelocity, setRequiredVelocity] = useState<RequiredVelocity | null>(null);
  const [chartData, setChartData] = useState<VelocityChartSeries[]>([]);

  useEffect(() => {
    async function loadVelocityData() {
      try {
        setLoading(true);
        setError(null);

        // Calculate velocity gap
        const gap = await calculateVelocityGap(projectId);
        setGapResult(gap);

        // Get current velocity
        const current = await getCurrentVelocity(projectId);
        setCurrentVelocity(current);

        // Get required velocity
        const required = await getRequiredVelocity(projectId, gap.isAhead ? 'future-deadline' : 'current-deadline');
        setRequiredVelocity(required);

        // Get chart data
        const charts = await getVelocityChartData(projectId, '6months');
        setChartData(charts);

      } catch (err) {
        console.error('Error loading velocity data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load velocity data');
      } finally {
        setLoading(false);
      }
    }

    loadVelocityData();
  }, [projectId]);

  if (loading) {
    return (
      <div className="velocity-gap-dashboard">
        <div className="velocity-loading">
          <p>{t('loading')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="velocity-gap-dashboard">
        <div className="velocity-error">
          <p>{t('error')}: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="velocity-gap-dashboard">
      {/* Header Section */}
      <div className="velocity-header">
        <h2>{t('dashboardTitle')}</h2>
        <p className="velocity-subtitle">{t('dashboardSubtitle')}</p>
      </div>

      {/* Velocity Gap Overview Card */}
      {gapResult && (
        <div
          className={`velocity-gap-card velocity-severity-${gapResult.severity}`}
        >
          <div className="velocity-gap-header">
            <h3>{t('gapOverview')}</h3>
            <span className={`velocity-badge velocity-badge-${gapResult.isAhead ? 'ahead' : 'behind'}`}>
              {gapResult.isAhead ? t('ahead') : t('behind')}
            </span>
          </div>

          <div className="velocity-gap-metrics">
            <div className="velocity-metric">
              <div className="velocity-metric-label">{t('currentVelocity')}</div>
              <div className="velocity-metric-value">
                {currentVelocity?.value} {currentVelocity?.unit}
              </div>
            </div>

            <div className="velocity-arrow">
              <div className="velocity-arrow-value">
                {gapResult.isAhead ? '+' : ''}
                {gapResult.gap > 0 ? gapResult.gap : 0}
              </div>
              <div className="velocity-arrow-label">
                {gapResult.isAhead ? t('aheadOfRequired') : t('behindRequired')}
              </div>
            </div>

            <div className="velocity-metric">
              <div className="velocity-metric-label">{t('requiredVelocity')}</div>
              <div className="velocity-metric-value">
                {requiredVelocity?.value} {requiredVelocity?.unit}
              </div>
            </div>
          </div>

          <div className="velocity-gap-explanation">
            <p>{gapResult.explanation}</p>
          </div>
        </div>
      )}

      {/* Visualization Section */}
      <div className="velocity-visualizations">
        <h3>{t('trendsAndVisualizations')}</h3>
        <div className="velocity-charts">
          {/* Historical Velocity Chart */}
          {chartData.map(series => (
            <div key={series.label} className="velocity-chart-section">
              <h4>{series.label}</h4>
              <div className="velocity-chart-placeholder">
                <p>{t('chartPlaceholder')}</p>
                <p className="velocity-chart-note">{t('chartNote')}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Summary */}
      {gapResult && (
        <div className="velocity-actions">
          <h3>{t('recommendationsAndActions')}</h3>
          <div className="velocity-action-summary">
            <p>{t('actionSummary', {
              gapPercentage: Math.abs(gapResult.percentage).toFixed(1),
              impact: gapResult.gap,
            })}</p>
          </div>

          {/* Secondary navigation to detailed sections */}
          <div className="velocity-navigation">
            <div className="velocity-nav-item">
              <button className="velocity-nav-button">
                {t('recommendationsButton')}
              </button>
            </div>
            <div className="velocity-nav-item">
              <button className="velocity-nav-button" disabled={!gapResult.isAhead}>
                {t('actionPlanButton')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}