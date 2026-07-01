import { QualityMetric } from './config.js';
import { calculateScore, type RiskLevel, type CalculatedScore, type Artifacts } from './score-engine.js';

export interface ScoreHistory {
  level: RiskLevel;
  justification: string;
  metrics: Record<string, number>;
  calculatedAt: Date;
  manuallyOverride: boolean | null;
  overriddenBy: string | null;
  overrideReason: string | null;
}

export interface Artifacts {
  id?: string;
  type: string;
  name: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface OverrideRequest {
  manualScore: RiskLevel;
  reason: string;
  overrideBy: string;
}

export { Artifacts };

export class QualityRiskScore {
  private config;
  private currentArtifacts: Map<string, Artifacts> = new Map();
  private currentMetrics: Map<string, Map<string, QualityMetric>> = new Map();  private scoreHistory: Map<string, ScoreHistory[]> = new Map();

  constructor(config: { metrics: QualityMetric[]; overrideAllowed: boolean }) {
    this.config = {
      metrics: config.metrics,
      overrideAllowed: config.overrideAllowed,
      reevaluationInterval: 5 // minutes, minimum for pragmatic implementation
    };
  }

  // Core scoring for an artifact
  public calculateRiskScore(
    artifactId: string,
    metrics: QualityMetric[]
  ): CalculatedScore {
    const score = calculateScore(metrics, this.config);
    
    // Store score for history
    this.updateHistory(artifactId, score, false, null, null, null);
    
    return score;
  }

  // Manual override - FR5
  public manualOverride(
    artifactId: string,
    override: OverrideRequest
  ): CalculatedScore | null {
    if (!this.currentArtifacts.has(artifactId)) {
      return null;
    }

    const metrics = this.getMetrics(artifactId);
    const calculated = calculateScore(metrics, this.config);

    // Create override history entry
    const overrideEntry: ScoreHistory = {
      level: override.manualScore,
      justification: calculated.justification,
      metrics: calculated.metrics,
      calculatedAt: new Date(),
      manuallyOverride: true,
      overriddenBy: override.overrideBy,
      overrideReason: override.reason
    };

    // Update history
    this.updateHistory(artifactId, overrideEntry, true, override.overrideBy, override.reason);

    // Return override score data
    return {
      level: override.manualScore,
      score: this.scoreToNumber(override.manualScore),
      justification: `${override.reason} (Override)`,
      metrics: calculated.metrics,
      rawScore: this.scoreToNumber(override.manualScore)
    };
  }

  // Re-evaluate when metrics change significantly - FR6
  public reevaluate(artifactId: string): CalculatedScore | null {
    const metrics = this.getMetrics(artifactId);
    if (!metrics) {
      return null;
    }

    const calculated = calculateScore(Array.from(metrics.values()), this.config);
    this.updateHistory(artifactId, calculated, false, null, null, null);
    
    return calculated;
  }

  // Get detailed breakdown - FR4
  public getArtifactsMetrics(artifactId: string): Record<string, {
    value: number;
    weight: number;
    thresholdHigh: number;
  }> | null {
    const metrics = this.getMetrics(artifactId);
    if (!metrics) {
      return null;
    }

    const result: Record<string, {
      value: number;
      weight: number;
      thresholdHigh: number;
    }> = {};

    for (const [name, metric] of metrics) {
      result[name] = {
        value: metric.value,
        weight: metric.weight,
        thresholdHigh: metric.threshold.high
      };
    }

    return result;
  }

  // Get score history for a specific artifact
  public getScoreHistory(artifactId: string): ScoreHistory[] | null {
    const history = this.scoreHistory.get(artifactId);
    if (!history) {
      return null;
    }

    // Sort by calculatedAt descending
    return [...history].sort((a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime());
  }

  // Register an artifact - FR3
  public registerArtifact(artifact: Artifacts): string {
    const id = artifact.id || `art-${Date.now()}`;
    this.currentArtifacts.set(id, artifact);
    
    // Initialize empty metrics storage for new artifact
    const artifactMetrics = new Map<string, QualityMetric>();
    this.currentMetrics.set(id, artifactMetrics);
    
    // Initialize empty history
    this.scoreHistory.set(id, []);
    
    return id;
  }

  // Update or add a metric for an artifact
  public updateMetric(artifactId: string, metric: QualityMetric): void {
    const artifactMetrics = this.currentMetrics.get(artifactId);
    if (!artifactMetrics) {
      throw new Error(`Artifact ${artifactId} not registered`);
    }

    artifactMetrics.set(metric.name, metric);
  }

  // Remove a metric for an artifact
  public removeMetric(artifactId: string, metricName: string): void {
    const artifactMetrics = this.currentMetrics.get(artifactId);
    if (!artifactMetrics) {
      throw new Error(`Artifact ${artifactId} not registered`);
    }

    artifactMetrics.delete(metricName);
  }

  // Get metrics for an artifact
  public getMetrics(artifactId: string): Map<string, QualityMetric> | null {
    return this.currentMetrics.get(artifactId) || null;
  }

  // Get all artifacts
  public getArtifacts(): Artifacts[] {
    return Array.from(this.currentArtifacts.values());
  }

  // Delete an artifact
  public deleteArtifact(artifactId: string): boolean {
    const deletedMetrics = this.currentMetrics.delete(artifactId);
    const deletedHistory = this.scoreHistory.delete(artifactId);
    const deletedArtifact = this.currentArtifacts.delete(artifactId);
    
    return deletedMetrics && deletedHistory && deletedArtifact;
  }

  private updateHistory(
    artifactId: string,
    score: CalculatedScore | ScoreHistory,
    isOverride: boolean,
    overriddenBy: string | null,
    overrideReason: string | null
  ): void {
    let history = this.scoreHistory.get(artifactId);
    if (!history) {
      history = [];
    }

    const historyEntry: ScoreHistory = {
      level: isOverride && score.level ? (score.level as RiskLevel) : score.level,
      justification: score.justification,
      metrics: score.metrics,
      calculatedAt: new Date(),
      manuallyOverride: isOverride,
      overriddenBy,
      overrideReason
    };

    history.push(historyEntry);
    this.scoreHistory.set(artifactId, history);
  }

  private scoreToNumber(level: RiskLevel): number {
    if (level === 'High') return 85;
    if (level === 'Medium') return 55;
    return 25;
  }
}