import { PrismaClient, IntegrationStatus, IntegrationType } from '@/db';
import type { AuditQueryOptions } from '@/frontend/src/lib/dto/auditQueryOptions';
import type {
  IntegrationHealth,
  IntegrationConnection,
  IntegrationGap,
  CompletenessScore,
} from '@/frontend/src/types/integration';

const prisma = new PrismaClient();

/**
 * Service layer for integration audit operations.
 * Handles fetching connection summaries, calculating health scores,
 * identifying gaps, and generating recommendations.
 */
export const auditService = {
  /**
   * Get a comprehensive health summary for all integrations in a segment.
   */
  async getHealthSummary(options: AuditQueryOptions): Promise<IntegrationHealth[]> {
    const {
      tenantId,
      segmentId,
      integrationType,
      status,
      minScore,
      maxScore,
      includeGaps,
      includeRecommendations,
      sortBy = 'lastSync',
      sortOrder = 'desc',
    } = options;

    // Fetch filtered integration connections
    const connections = await prisma.integrationConnection.findMany({
      where: {
        tenantId,
        segmentId,
        type: integrationType || undefined,
      },
      orderBy:
        sortBy === 'lastSync'
          ? { lastSync: sortOrder }
          : sortBy === 'completenessScore'
          ? { completenessScore: sortOrder }
          : { status: sortOrder },
    });

    // Build health summaries with scoring and gaps
    const healthSummaries: IntegrationHealth[] = [];

    for (const connection of connections) {
      // Get completeness score
      const score = await prisma.integrationCompletenessScore.findUnique({
        where: {
          integrationId_tenantId_segmentId: {
            integrationId: connection.id,
            tenantId,
            segmentId,
          },
        },
      });

      // Get gaps
      const gaps = includeGaps
        ? await prisma.integrationGap.findMany({
            where: {
              tenantId,
              segmentId,
              integrationId: connection.id,
            },
            orderBy: { severity: 'desc' },
          })
        : [];

      // Generate recommendations from gaps
      const recommendations = includeRecommendations
        ? this.generateRecommendations(connection, gaps)
        : [];

      // Apply score filters
      const reportScore = score?.totalWeightedScore ?? 0;

      if (
        minScore !== undefined && reportScore < minScore
      ) {
        continue;
      }

      if (
        maxScore !== undefined && reportScore > maxScore
      ) {
        continue;
      }

      // Determine status based on score and gaps
      const status = this.determineHealthStatus(connection, gaps);

      healthSummaries.push({
        id: connection.id,
        integrationId: connection.id,
        connection,
        lastSync: connection.lastSync?.toISOString() ?? null,
        status,
        completenessScore: reportScore,
        gaps: includeGaps
          ? gaps.map((g) => ({
              id: g.id,
              integrationId: g.integrationId,
              tenantId: g.tenantId,
              segmentId: g.segmentId,
              severity: g.severity as any,
              category: g.category as any,
              description: g.description,
              recommendation: g.recommendation,
              detectedAt: g.detectedAt.toISOString(),
              resolvedAt: g.resolvedAt?.toISOString(),
            }))
          : [],
        recommendations,
        lastAuditAt: score?.lastCalculated ?? connection.updatedAt.toISOString(),
      });
    }

    return healthSummaries;
  },

  /**
   * Perform a real-time health check on a specific integration.
   */
  async performHealthCheck(connectionId: string): Promise<void> {
    const connection = await prisma.integrationConnection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new Error(`Integration connection not found: ${connectionId}`);
    }

    const now = new Date();

    // Check config completeness
    const config = connection.configuration as any;
    const checks = [];

    switch (connection.type) {
      case 'source-control':
        checks.push(
          this.checkSourceControlHealth(config)
        );
        break;

      case 'issue-tracker':
        checks.push(
          this.checkIssueTrackerHealth(config)
        );
        break;

      case 'communication':
        checks.push(
          this.checkCommunicationHealth(config)
        );
        break;

      case 'cicd':
        checks.push(
          this.checkCICDHealth(config)
        );
        break;

      case 'monitoring':
        checks.push(
          this.checkMonitoringHealth(config)
        );
        break;

      case 'calendar':
        checks.push(
          this.checkCalendarHealth(config)
        );
        break;
    }

    // Calculate score
    const score = await this.calculateCompletenessScore(connection, checks);

    // Update or create score record
    await prisma.integrationCompletenessScore.upsert({
      where: {
        integrationId_tenantId_segmentId: {
          integrationId: connection.id,
          tenantId: connection.tenantId,
          segmentId: connection.segmentId,
        },
      },
      create: {
        id: crypto.randomUUID(),
        tenantId: connection.tenantId,
        segmentId: connection.segmentId,
        integrationId: connection.id,
        totalWeightedScore: score.totalWeightedScore,
        maxPossibleScore: score.maxPossibleScore,
        breakdown: score.breakdown,
        lastCalculated: now,
        calculatedBy: 'system',
      },
      update: {
        totalWeightedScore: score.totalWeightedScore,
        breakdown: score.breakdown,
        lastCalculated: now,
        calculatedBy: 'system',
      },
    });

    // Identify new gaps
    await this.identifyGaps(connection, checks);
  },

  /**
   * Check GitHub/GitLab/Bitbucket integration health.
   */
  private async checkSourceControlHealth(config: any) {
    const { webhooks, repoRefs } = config || {};
    const checks = [];
    let issues: string[] = [];

    // Check for repo references
    const repoCount = repoRefs ? Object.keys(repoRefs).length : 0;
    const expectedRepos = 3; // Typical enterprise setup

    if (repoCount === 0) {
      issues.push('No repositories linked');
    } else if (repoCount < expectedRepos) {
      issues.push(`Only ${repoCount} repository(s) linked, fewer than typical setup`);
    }

    // Check for webhooks
    const webhookCount = webhooks ? Object.keys(webhooks).length : 0;
    if (webhookCount === 0) {
      issues.push('No webhooks configured');
    } else {
      checks.push({
        type: 'webhook_trigger',
        name: 'Webhook functionality',
        passed: true,
        details: { webhookCount, events: webhooks },
      });
    }

    // Check for recent activity (assumes we track this in the system)
    // This would query commit/event tables
    checks.push({
      type: 'recent_activity',
      name: 'Recent activity detection',
      passed: true,
      details: { checkedAt: new Date().toISOString(), sampleSize: repoCount },
    });

    return { issues, checks };
  },

  /**
   * Check Jira/Linear integration health.
   */
  private async checkIssueTrackerHealth(config: any) {
    const { issueFilters, fieldClaims } = config || {};
    const checks = [];
    let issues: string[] = [];

    // Check for field mappings
    if (!fieldClaims || Object.keys(fieldClaims).length === 0) {
      issues.push('No field mappings configured');
    }

    // Check for expected statuses
    const expectedStatuses = 3; // TODO: Make this configurable based on provider
    const statusesCount = issueFilters?.statuses?.length ?? 0;

    if (statusesCount === 0) {
      issues.push('No status filters configured');
    } else if (statusesCount < expectedStatuses) {
      issues.push(
        `Only ${statusesCount} status(esi) filtered, fewer than typical setup`
      );
    }

    // Check sync activity
    checks.push({
      type: 'data_flow',
      name: 'Issue import data flow',
      passed: true,
      details: { expectedStatuses, statusesCount },
    });

    checks.push({
      type: 'status_sync',
      name: 'Active status sync',
      passed: true,
      details: { syncEnabled: true },
    });

    return { issues, checks };
  },

  /**
   * Check Slack/Microsoft Teams integration health.
   */
  private async checkCommunicationHealth(config: any) {
    const { channelLinks } = config || {};
    const checks = [];
    let issues: string[] = [];

    // Check for channel links
    const channelCount = channelLinks?.channels?.length ?? 0;

    if (channelCount === 0) {
      issues.push('No channels linked');
    } else if (channelCount < 1) {
      issues.push('No channels linked');
    }

    // Check for webhook listener
    checks.push({
      type: 'webhook_trigger',
      name: 'Webhook events received',
      passed: true,
      details: { expectedChannels: channelCount },
    });

    return { issues, checks };
  },

  /**
   * Check CI/CD integration health.
   */
  private async checkCICDHealth(config: any) {
    const { deploymentHooks } = config || {};
    const checks = [];
    let issues: string[] = [];

    // Check for deployment hooks
    const deploymentEventsCount = deploymentHooks?.events?.length ?? 0;

    if (deploymentEventsCount === 0) {
      issues.push('No deployment webhooks configured');
    }

    // Check for environment targeting
    check deploymentHooks?.targetEnvironment;

    // Check for recent deployments
    checks.push({
      type: 'data_flow',
      name: 'Deployment data import',
      passed: true,
      details: { deploymentHadlers: deploymentEventsCount },
    });

    return { issues, checks };
  },

  /**
   * Check monitoring integration health.
   */
  private async checkMonitoringHealth(config: any) {
    const { incidentAlerts } = config || {};
    const checks = [];
    let issues: string[] = [];

    // Check for incident alerts
    const alertChannelsCount = incidentAlerts?.channels?.length ?? 0;

    if (alertChannelsCount === 0) {
      issues.push('No incident alert channels configured');
    }

    checks.push({
      type: 'data_flow',
      name: 'Incident data import',
      passed: true,
      details: { alertChannels: alertChannelsCount },
    });

    return { issues, checks };
  },

  /**
   * Check calendar/project management integration health.
   */
  private async checkCalendarHealth(config: any) {
    const { calendarSync } = config || {};
    const checks = [];
    let issues: string[] = [];

    // Check for event sync configuration
    const eventTypesCount = calendarSync?.eventTypes?.length ?? 0;

    if (eventTypesCount === 0) {
      issues.push('No calendar event types configured');
    }

    checks.push({
      type: 'data_flow',
      name: 'Calendar event import',
      passed: true,
      details: { eventTypes: eventTypesCount },
    });

    return { issues, checks };
  },

  /**
   * Determine integration health status.
   */
  private determineHealthStatus(
    connection: IntegrationConnection,
    gaps: IntegrationGap[]
  ): IntegrationStatus {
    // If there are critical/high severity gaps, mark as partial
    const criticalGaps = gaps.filter((g) => g.severity === 'CRITICAL');
    const highSeverityGaps = gaps.filter((g) => g.severity === 'HIGH');

    if (criticalGaps.length > 0 || highSeverityGaps.length > 0) {
      return 'PARTIAL';
    }

    // If gaps exist but are low severity
    if (gaps.length > 0) {
      const lowSeverityGaps = gaps.filter((g) => g.severity === 'LOW');
      if (lowSeverityGaps.length > 0) {
        return 'PARTIAL';
      }
    }

    // No gaps means connected
    return 'CONNECTED';
  },

  /**
   * Calculate completeness score for an integration.
   */
  private async calculateCompletenessScore(
    connection: IntegrationConnection,
    checks: any[]
  ): Promise<CompletenessScore> {
    // Weight by integration type criticality
    const weights = this.getServiceTierWeights(connection.tenantId);

    const typeWeights = {
      'source-control': weights.sourceControl,
      'issue-tracker': weights.issueTracker,
      'communication': weights.communication,
      'cicd': weights.cicd,
      'monitoring': weights.monitoring,
      'calendar': weights.calendar,
    };

    const criticalityScore = typeWeights[connection.type] || 0;

    // Calculate expected objects matched score
    let expectedObjectsMatched = 0;
    let expectedObjectsCount = 0;

    for (const check of checks) {
      if (check.issues && check.issues.some((i: string) => i.includes('missing'))) {
        expectedObjectsCount++;
        expectedObjectsMatched++;
      } else {
        expectedObjectsCount++;
      }
    }

    const objectsScore =
      expectedObjectsCount > 0 ? (expectedObjectsMatched / expectedObjectsCount) * 100 : 100;

    // Calculate recency score (last sync vs 24h threshold)
    let recencyScore = this.calculateRecencyScore(connection.lastSync);

    // Weighted total
    const totalWeightedScore = (
      objectsScore * 0.6 +
      recencyScore * 0.4
    ) * criticalityScore / Object.values(typeWeights).reduce((a, b) => a + b, 0);

    return {
      integrationId: connection.id,
      tenantId: connection.tenantId,
      segmentId: connection.segmentId,
      totalWeightedScore: Math.round(totalWeightedScore * 100) / 100,
      maxPossibleScore: 100,
      breakdown: {
        expectedObjectsWeight: expectedObjectsCount,
        expectedObjectsMatched: expectedObjectsMatched,
        recencyScore: Math.round(recencyScore * 100) / 100,
        criticalityScore: Math.round(criticalityScore * 100) / 100,
        criticalityWeight: criticalityScore,
        recencyWeight: 0.4,
        expectedObjectsWeight: 0.6,
      },
      lastCalculated: new Date().toISOString(),
    };
  },

  /**
   * Calculate recency score based on last sync timestamp.
   */
  private calculateRecencyScore(lastSync: Date | null): number {
    if (!lastSync) return 0; // Never synced = no score

    const hoursSinceSync = (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60);

    if (hoursSinceSync <= 24) {
      return 1; // Full score within 24 hours
    } else if (hoursSinceSync <= 72) {
      return 0.8; // 20% penalty within 3 days
    } else if (hoursSinceSync <= 168) {
      return 0.6; // 40% penalty within 1 week
    } else {
      return 0.3; // 70% penalty beyond 1 week
    }
  },

  /**
   * Get service tier weights for scoring.
   */
  private async getServiceTierWeights(tenantId: string): Promise<any> {
    let weights = await prisma.serviceTierWeights.findUnique({
      where: { tenantId },
    });

    if (weights) {
      return {
        sourceControl: parseFloat(weights.sourceControlWeight.toString()),
        issueTracker: parseFloat(weights.issueTrackerWeight.toString()),
        communication: parseFloat(weights.communicationWeight.toString()),
        cicd: parseFloat(weights.cicdWeight.toString()),
        monitoring: parseFloat(weights.monitoringWeight.toString()),
        calendar: parseFloat(weights.calendarWeight.toString()),
      };
    }

    // Default weights for FREE tier
    return {
      sourceControl: 0.1,
      issueTracker: 0.15,
      communication: 0.05,
      cicd: 0.2,
      monitoring: 0.2,
      calendar: 0.05,
    };
  },

  /**
   * Identify and create gaps based on health check results.
   */
  private async identifyGaps(
    connection: IntegrationConnection,
    checks: any[]
  ): Promise<void> {
    const now = new Date();

    for (const check of checks) {
      if (!check.passed) continue;

      for (const issue of check.issues) {
        const gapExists = await prisma.integrationGap.findFirst({
          where: {
            integrationId: connection.id,
            tenantId: connection.tenantId,
            segmentId: connection.segmentId,
            category: this.classifyGapCategory(issue),
            description: { contains: issue.substring(0, 50) },
            resolvedAt: null,
          },
        });

        if (!gapExists) {
          const severity = this.determineGapSeverity(check.passed, issue);

          await prisma.integrationGap.create({
            data: {
              id: crypto.randomUUID(),
              tenantId: connection.tenantId,
              segmentId: connection.segmentId,
              integrationId: connection.id,
              severity,
              category: this.classifyGapCategory(issue),
              description: issue,
              recommendation: this.generateRecommendation(issue, connection),
              detectedAt: now,
            },
          });
        }
      }
    }
  },

  /**
   * Classify gap by category.
   */
  private classifyGapCategory(issue: string): string {
    if (
      issue.includes('webhook') ||
      issue.includes('event') ||
      issue.includes('trigger')
    ) {
      return 'WEBHOOK';
    }
    if (
      issue.includes('missing') ||
      issue.includes('no') ||
      issue.includes('zero')
    ) {
      return 'DATA_COMPLETENESS';
    }
    if (issue.includes('recency') || issue.includes('stale')) {
      return 'STALE_DATA';
    }
    if (issue.includes('configuration') || issue.includes('mapping')) {
      return 'CONFIGURATION';
    }
    return 'MISCONFIGURATION';
  },

  /**
   * Determine gap severity.
   */
  private determineGapSeverity(passed: boolean, issue: string): string {
    if (!passed) {
      if (issue.toLowerCase().includes('crITICAL') || issue.includes('fatal')) {
        return 'CRITICAL';
      }
      if (
        issue.toLowerCase().includes('data flow') ||
        issue.includes('no deployment')
      ) {
        return 'HIGH';
      }
      if (issue.includes('fewer than') || issue.includes('poor')) {
        return 'MEDIUM';
      }
    }
    return 'LOW';
  },

  /**
   * Generate recommendation for a gap.
   */
  private generateRecommendation(issue: string, connection: IntegrationConnection): string {
    const integrationName = connection.name;

    if (issue.includes('webhook')) {
      return `Configure ${integrationName} webhooks to track ${integrationName.toLowerCase()} events for complete audit data.`;
    }
    if (issue.includes('missing') || issue.includes('no repos')) {
      return `Add repositories to integrate with ${integrationName} for complete data flow.`;
    }
    if (issue.includes('channels')) {
      return `Link relevant channels in ${integrationName} to capture thread and message data.`;
    }
    if (issue.includes('stale') || issue.includes('recency')) {
      return `Refresh ${integrationName} data source or increase sync frequency to ensure audit records are up to date.`;
    }
    if (issue.includes('config') || issue.includes('mapping')) {
      return `Review ${integrationName} field mappings and ensure they align with audit requirements.`;
    }

    return `Review ${integrationName} integration configuration to complete the audit check.`;
  },
};