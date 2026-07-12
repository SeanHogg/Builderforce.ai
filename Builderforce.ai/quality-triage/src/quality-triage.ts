/**
 * Quality Improvement - Main Orchestrator
 *
 * Ties together ingestion, analysis, recommendation generation, and human approval
 * into a cohesive quality improvement workflow.
 */

import { Bug } from './services/bug-ingestion.js';
import { DefectDensityScore, Hotspot, RecurrencePattern } from './types.js';
import { RecommendationGenerationOptions } from './services/recommendation-engine.js';
import { BugIngestionService } from './services/bug-ingestion.js';
import { BugAnalysisService } from './services/bug-analysis.js';
import { RecommendationEngine } from './services/recommendation-engine.js';
import { HumanApprovalGate } from './services/human-approval-gate.js';
import { QualityConfig } from './types.js';

export interface QualityTriageResult {
  recommendations: Array<{
    id: string;
    type: string;
    priority: number;
    summary: string;
    details: string;
    status: string;
  }>;
  hotspots: Hotspot[];
  stats: {
    totalBugs: number;
    modulesViolating: string[];
    highPriorityRecommendations: number;
  };
}

export interface QualityTriageOptions {
  projectId?: string;
  since?: string;
  forceTrigger: boolean;
}

export class QualityTriage {
  private ingestionService: BugIngestionService;
  private analysisService: BugAnalysisService;
  private recommendationEngine: RecommendationEngine;
  private approvalGate: HumanApprovalGate;
  private currentBugs: Bug[];
  private config: QualityConfig;

  constructor(config: QualityConfig) {
    this.config = config;
    this.ingestionService = new BugIngestionService(config);
    this.approvalGate = new HumanApprovalGate();
    this.currentBugs = [];
  }

  /**
   * Run complete quality improvement workflow
   */
  async run(options: QualityTriageOptions = { forceTrigger: false }): Promise<QualityTriageResult> {
    console.log('🔍 Starting Quality Improvement analysis...');
    console.log(`  Project: ${options.projectId || 'default'}`);
    console.log(`  Since: ${options.since || 'last 7 days'}`);
    console.log('');

    // Step 1: Ingest bugs
    console.log('📥 Ingesting bugs from issue trackers...');
    const bugs = await this.ingestionService.ingestBugs({
      projectId: options.projectId,
      since: options.since,
    });
    this.currentBugs = bugs;

    console.log(`✓ Ingested ${bugs.length} bugs`);
    console.log('');

    // Exit early if no bugs found
    if (bugs.length === 0) {
      console.log('ℹ️  No bugs found - nothing to triage');
      return {
        recommendations: [],
        hotspots: [],
        stats: {
          totalBugs: 0,
          modulesViolating: [],
          highPriorityRecommendations: 0,
        },
      };
    }

    // Step 2: Analyze bugs
    console.log('🔬 Analyzing bug data...');
    this.analysisService = new BugAnalysisService(bugs, this.config);
    const analysis = await this.analysisService.analyze();

    const defectScores = analysis.defectDensityScores;
    const hotspots = analysis.hotspots;
    const recurrences = analysis.recurrencePatterns;

    console.log(`✓ Identified ${hotspots.length} hotspots`);
    console.log(`✓ Detected ${recurrences.length} recurrence patterns`);
    console.log('');

    // Step 3: Generate recommendations
    console.log('💡 Generating recommendations...');
    const genOptions: RecommendationGenerationOptions = {
      limit: this.config.recommendation?.topN || 5,
      includeTesting: true,
      includeReview: true,
      includeRefactoring: true,
      includeRecurrenceWarnings: true,
    };

    this.recommendationEngine = new RecommendationEngine(
      hotspots,
      this.recurrenceMapToRecord(recurrences),
      bugs,
      this.config
    );

    const recommendations = this.recommendationEngine.generateRecommendations(genOptions);

    console.log(`✓ Generated ${recommendations.length} recommendations`);
    console.log('');

    // Step 4: Submit for approval if required
    if (this.config.integrations?.qualityServer?.requireHumanApproval !== false) {
      console.log('🔒 Submitting recommendations for human review...');
      this.approvalGate.clearCompleted(); // Reset stale approvals

      recommendations.forEach((rec) => {
        this.approvalGate.submitForApproval(rec.id, rec.refactorTaskPayload);
      });

      const pendingCount = this.approvalGate.getPendingApprovals().length;
      console.log(`✓ Waiting for ${pendingCount} approvals`);
    }

    // Step 5: Gather stats
    const modulesViolating = defectScores
      .filter(score => score.isAboveThreshold)
      .map(score => score.modulePath);

    const highPriorityRecs = recommendations.filter(r => r.priority >= 70);

    console.log('✅ Quality Improvement analysis complete!');
    console.log('');

    // Return result
    return {
      recommendations: recommendations.map((rec, i) => ({
        id: rec.id,
        type: rec.type,
        priority: rec.priority,
        summary: `${rec.type.toUpperCase()}: ${rec.action.substring(0, 50)}...`,
        details: `${rec.rationale}\n\nAction: ${rec.action}`,
        status: this.getStatusForRec(rec),
      })),
      hotspots,
      stats: {
        totalBugs: bugs.length,
        modulesViolating,
        highPriorityRecommendations: highPriorityRecs.length,
      },
    };
  }

  /**
   * Get approval status for a recommendation
   */
  getStatusForRec(rec: any): string {
    if (!this.approvalGate) return 'generated';

    const approval = this.approvalGate.getApprovalState(rec.id);
    if (!approval) return 'generated';

    if (approval.approved) return 'approved';
    if (approval.rejectReason) return 'rejected';

    return 'pending_approval';
  }

  /**
   * Map recurrence patterns array to record
   */
  private recurrenceMapToRecord(
    patterns: Array<RecurrencePattern>
  ): Record<string, { file: string; recurrenceCount: number; lastBugDate: string }> {
    const record: Record<string, { file: string; recurrenceCount: number; lastBugDate: string }> = {};

    patterns.forEach((p) => {
      if (!record[p.file]) {
        record[p.file] = {
          file: p.file,
          recurrenceCount: 0,
          lastBugDate: '',
        };
      }
      record[p.file].recurrenceCount++;
      record[p.file].lastBugDate = p.lastBugDate;
    });

    return record;
  }

  /**
   * Manually trigger analysis for specific module
   */
  async analyzeModule(modulePath: string): Promise<QualityTriageResult> {
    console.log(`🔍 Analyzing module: ${modulePath}`);

    const bugs = this.currentBugs.filter(
      bug => bug.files?.includes(modulePath) || bug.modules?.includes(modulePath)
    );

    if (bugs.length === 0) {
      return {
        recommendations: [],
        hotspots: [],
        stats: {
          totalBugs: 0,
          modulesViolating: [],
          highPriorityRecommendations: 0,
        },
      };
    }

    // Run analysis
    const analysis = await this.analysisService.analyze();

    // Filter hotspots for this module
    const moduleHotspots = analysis.hotspots.filter(h => h.modulePath === modulePath);

    // Generate recommendations
    this.recommendationEngine = new RecommendationEngine(
      moduleHotspots,
      this.recurrenceMapToRecord(analysis.recurrencePatterns),
      bugs,
      this.config
    );

    const recommendations = this.recommendationEngine.generateRecommendations({
      limit: 3,
      includeTesting: true,
      includeReview: true,
      includeRefactoring: true,
      includeRecurrenceWarnings: true,
    });

    console.log(`✅ Module analysis complete: ${recommendations.length} recommendations`);

    return {
      recommendations: recommendations.map((rec) => ({
        id: rec.id,
        type: rec.type,
        priority: rec.priority,
        summary: `${rec.type.toUpperCase()}: ${rec.action.substring(0, 50)}...`,
        details: `${rec.rationale}\n\nAction: ${rec.action}`,
        status: this.getStatusForRec(rec),
      })),
      hotspots: moduleHotspots,
      stats: {
        totalBugs: bugs.length,
        modulesViolating: modulePath,
        highPriorityRecommendations: recommendations.filter(r => r.priority >= 70).length,
      },
    };
  }

  /**
   * Get approval state for a specific recommendation
   */
  getApprovalState(recommendationId: string): any {
    return this.approvalGate.getApprovalState(recommendationId);
  }

  /**
   * Approve a recommendation
   */
  approveRecommendation(
    recommendationId: string,
    approverName: string,
    agentProposal?: any
  ): boolean {
    return this.approvalGate.approve(
      recommendationId,
      'user',
      approverName,
      agentProposal
    );
  }

  /**
   * Reject a recommendation
   */
  rejectRecommendation(recommendationId: string, reason: string): boolean {
    return this.approvalGate.reject(recommendationId, reason);
  }

  /**
   * Export results for external tooling
   */
  exportResults(): {
    bugs: number;
    hotspots: Hotspot[];
    recommendations: any[];
    thresholdBreaches: string[];
  } {
    const analysis = this.analysisService;
    const scores = analysis.computeDefectDensityScores();

    return {
      bugs: this.currentBugs.length,
      hotspots: analysis.identifyHotspots(scores),
      recommendations: [], // Would need full state in production
      thresholdBreaches: scores
        .filter(s => s.isAboveThreshold)
        .map(s => s.modulePath),
    };
  }
}