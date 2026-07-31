import type { QualityMetric, RiskScoreConfig, Artifact } from './config.js';
import {
  calculateScore,
  type RiskLevel,
  type CalculatedScore,
} from './score-engine.js';

export interface ScoreHistoryEntry {
  level: RiskLevel;
  justification: string;
  metrics: CalculatedScore['metrics'];
  calculatedAt: Date;
  manuallyOverride: boolean | null;
  overriddenBy: string | null;
  overrideReason: string | null;
}

export interface OverrideRequest {
  manualScore: RiskLevel;
  reason: string;
  overrideBy: string;
}

export { type Artifact };
export type { RiskLevel, CalculatedScore };

export class QualityRiskScore {
  private config: RiskScoreConfig;
  private currentArtifacts: Map<string, Artifact> = new Map();
  private metricsStore: Map<string, Map<string, QualityMetric>> = new Map();
  private scoreHistory: Map<string, ScoreHistoryEntry[]> = new Map();

  constructor(config: RiskScoreConfig) {
    this.config = { ...config };
  }

  public calculateRiskScore(
    artifactId: string,
    metrics: QualityMetric[],
  ): CalculatedScore {
    const score = calculateScore(metrics, this.config);
    this.pushHistory(artifactId, score, false, null, null);
    return score;
  }

  public manualOverride(
    artifactId: string,
    override: OverrideRequest,
  ): CalculatedScore | null {
    if (!this.currentArtifacts.has(artifactId)) {
      return null;
    }

    const mets = this.metricsStore.get(artifactId);
    const calculated = calculateScore(
      Array.from((mets ?? new Map()).values()),
      this.config,
    );

    const overridden: CalculatedScore = {
      level: override.manualScore,
      score: this.scoreToNumber(override.manualScore),
      justification: `${override.reason} (Override)`,
      metrics: calculated.metrics,
      rawScore: this.scoreToNumber(override.manualScore),
    };

    this.pushHistory(artifactId, overridden, true, override.overrideBy, override.reason);

    return overridden;
  }

  public reevaluate(artifactId: string): CalculatedScore | null {
    const mets = this.metricsStore.get(artifactId);
    if (!mets) {
      return null;
    }

    const calculated = calculateScore(Array.from(mets.values()), this.config);
    this.pushHistory(artifactId, calculated, false, null, null);
    return calculated;
  }

  public getArtifactMetrics(
    artifactId: string,
  ): Record<
    string,
    { value: number; weight: number; thresholdHigh: number }
  > | null {
    const mets = this.metricsStore.get(artifactId);
    if (!mets) {
      return null;
    }

    const result: Record<
      string,
      { value: number; weight: number; thresholdHigh: number }
    > = {};
    for (const [name, metric] of mets) {
      result[name] = {
        value: metric.value,
        weight: metric.weight,
        thresholdHigh: metric.threshold.high,
      };
    }
    return result;
  }

  public getScoreHistory(artifactId: string): ScoreHistoryEntry[] | null {
    const history = this.scoreHistory.get(artifactId);
    if (!history) {
      return null;
    }
    return [...history].sort(
      (a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime(),
    );
  }

  public registerArtifact(artifact: Artifact): string {
    const id = artifact.id ?? `art-${Date.now()}`;
    this.currentArtifacts.set(id, artifact);
    this.metricsStore.set(id, new Map());
    this.scoreHistory.set(id, []);
    return id;
  }

  public updateMetric(artifactId: string, metric: QualityMetric): void {
    const artifactMetrics = this.metricsStore.get(artifactId);
    if (!artifactMetrics) {
      throw new Error(`Artifact ${artifactId} not registered`);
    }
    artifactMetrics.set(metric.name, metric);
  }

  public removeMetric(artifactId: string, metricName: string): void {
    const artifactMetrics = this.metricsStore.get(artifactId);
    if (!artifactMetrics) {
      throw new Error(`Artifact ${artifactId} not registered`);
    }
    artifactMetrics.delete(metricName);
  }

  public getMetrics(artifactId: string): Map<string, QualityMetric> | null {
    return this.metricsStore.get(artifactId) ?? null;
  }

  public getArtifacts(): Artifact[] {
    return Array.from(this.currentArtifacts.values());
  }

  public deleteArtifact(artifactId: string): boolean {
    const deletedMetrics = this.metricsStore.delete(artifactId);
    const deletedHistory = this.scoreHistory.delete(artifactId);
    const deletedArtifact = this.currentArtifacts.delete(artifactId);
    return deletedMetrics && deletedHistory && deletedArtifact;
  }

  // ─── private helpers ────────────────────────────────────────────

  private pushHistory(
    artifactId: string,
    score: CalculatedScore,
    isOverride: boolean,
    overriddenBy: string | null,
    overrideReason: string | null,
  ): void {
    const history = this.scoreHistory.get(artifactId) ?? [];

    const entry: ScoreHistoryEntry = {
      level: score.level,
      justification: score.justification,
      metrics: score.metrics,
      calculatedAt: new Date(),
      manuallyOverride: isOverride || null,
      overriddenBy,
      overrideReason,
    };

    history.push(entry);
    this.scoreHistory.set(artifactId, history);
  }

  private scoreToNumber(level: RiskLevel): number {
    switch (level) {
      case 'High':
        return 85;
      case 'Medium':
        return 55;
      default:
        return 25;
    }
  }
}
