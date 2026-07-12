/**
 * Bug Ingestion Service
 *
 * Connects to various issue trackers (GitHub Issues, Jira, Linear, Azure DevOps)
 * and ingests bug data into the quality system.
 */

import { Bug, Severity } from '../types.js';
import { QualityConfig } from '../types.js';

export interface IssueTrackerConfig {
  type: 'github' | 'jira' | 'linear' | 'azure_devops';
  enabled: boolean;
  token?: string;
  baseUrl?: string;
}

export interface IngestionOptions {
  projectId?: string;
  since?: string; // ISO date string
  maxIssues?: number;
  thatOnlyIncludeBugs?: string[]; // labels to include as bugs
}

export class BugIngestionService {
  private config: QualityConfig;
  private trackers: Map<string, IssueTrackerConfig>;
  private readonly DEFAULT_THRESHOLDS = {
    repository: 50,
    module: 15,
    file: 3,
  };
  private readonly DEFAULT_WEIGHTS: { [key in Severity] } = {
    [Severity.CRITICAL]: 3,
    [Severity.MAJOR]: 2,
    [Severity.MINOR]: 1,
  };

  constructor(config: QualityConfig) {
    this.config = config;
    this.trackers = new Map();

    // Initialize trackers from config
    if (config.integrations.issueTrackers) {
      Object.entries(config.integrations.issueTrackers).forEach(([id, trackerConfig]) => {
        this.trackers.set(id, trackerConfig as IssueTrackerConfig);
      });
    }
  }

  /**
   * Get all configured trackers
   */
  getTrackers(): IssueTrackerConfig[] {
    return Array.from(this.trackers.values());
  }

  /**
   * Check if a specific tracker is enabled
   */
  isTrackerEnabled(trackerType: string): boolean {
    const tracker = this.trackers.get(trackerType);
    return tracker?.enabled === true;
  }

  /**
   * Ingest bugs from all enabled issue trackers
   */
  async ingestBugs(options: IngestionOptions = {}): Promise<Bug[]> {
    const bugs: Bug[] = [];

    for (const [trackerId, tracker] of this.trackers.entries()) {
      if (!tracker.enabled || !tracker.token) {
        continue;
      }

      try {
        let trackerBugs: Bug[];
        switch (tracker.type) {
          case 'github':
            trackerBugs = await this.ingestGitHubIssues(tracker, options);
            break;
          case 'jira':
            trackerBugs = await this.ingestJiraIssues(tracker, options);
            break;
          case 'linear':
            trackerBugs = await this.ingestLinearIssues(tracker, options);
            break;
          case 'azure_devops':
            trackerBugs = await this.ingestAzureDevOpsIssues(tracker, options);
            break;
          default:
            continue;
        }

        bugs.push(...trackerBugs);
      } catch (error) {
        console.error(`Failed to ingest from ${tracker.type}:`, error);
        // Continue with other trackers
      }
    }

    return bugs;
  }

  /**
   * Normalize bug severity to common tier
   */
  normalizeSeverity(severity: string): Severity {
    const upper = severity.toUpperCase();
    if (upper.includes('CRITICAL') || upper.includes('SEV1') || upper.includes('BLOCKER')) {
      return Severity.CRITICAL;
    }
    if (upper.includes('MAJOR') || upper.includes('SEV2') || upper.includes('IMPORTANT')) {
      return Severity.MAJOR;
    }
    return Severity.MINOR;
  }

  /**
   * Parse source ID from issue tracker
   */
  parseSourceId(source: string, type: string): string {
    // Store both external ID and normalized contract ID
    // e.g., "GHI-123" or "GH-45" -> store normalized UUID
    return `${type.toUpperCase()}-${source}`;
  }

  /**
   * Extract file paths from GitHub Issue comments or body
   */
  extractFilePaths(issueBody: string): string[] {
    // Pattern 1: filepath references (simple heuristic)
    const filePatterns = /\b[A-Z][a-zA-Z0-9_/\\]*\.ts\b/g;
    const files = new Set<string>();

    const matches = issueBody.match(filePatterns);
    if (matches) {
      matches.forEach((match) => files.add(match.replace('\\', '/')));
    }

    // Pattern 2: File references in "File:" or "Files:" tags
    const tagPatterns = /(?:File|Files):\s*([^\n]+)/gi;
    const tagMatches = issueBody.matchAll(tagPatterns);
    tagMatches.forEach((match) => {
      const paths = match[1].split(',').map((p) => p.trim());
      paths.forEach((p) => files.add(p.replace('\\', '/')));
    });

    // Pattern 3: React component file patterns
    const componentPatterns = /(Component|Service|Util|Helper|Hook|Type)[A-Za-z]*\.ts\b/gi;
    const componentMatches = issueBody.matchAll(componentPatterns);
    componentMatches.forEach((match) => {
      files.add(match[0].replace('\\', '/'));
    });

    return Array.from(files);
  }

  /**
   * Extract file paths from Jira issue description or comments
   */
  extractFilePathsJira(description: string, comments?: string[]): string[] {
    const filePatterns = /\.(ts|tsx|js|jsx|py|java|rs|go|swift|kt|rb)\b/gi;
    const files = new Set<string>();

    const text = [description, ...(comments || [])].join('\n');

    const matches = text.matchAll(filePatterns);
    matches.forEach((match) => {
      // Filter out library imports and non-code files
      if (!match[0].includes('node_modules') &&
          !match[0].includes('src/lib') &&
          !match[0].includes('dist') &&
          !match[0].includes('build')) {
        files.add(match[0].replace(/\\/g, '/'));
      }
    });

    return Array.from(files);
  }

  /* --- Issue Tracker Implementations --- */

  /**
   * GitHub Issues Ingestion
   */
  private async ingestGitHubIssues(
    tracker: IssueTrackerConfig,
    options: IngestionOptions
  ): Promise<Bug[]> {
    const baseUrl = tracker.baseUrl || 'https://api.github.com';
    const token = tracker.token;
    // Default repository: seanhogg/builderforce.ai if project not specified
    const repo = options.projectId?.includes('/') ? options.projectId : 'seanhogg/builderforce.ai';
    const sinceDate = options.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let bugs: Bug[] = [];

    // Get open and closed issues (last 30 days to avoid stale data)
    try {
      // API rate limit considerations:
      // Uses paginated requests with reasonable page sizes
      const issueParams = new URLSearchParams({
        state: 'all',
        labels: options.thatOnlyIncludeBugs?.join(',') || '',
        since: sinceDate,
        per_page: '100',
      });

      const res = await fetch(`${baseUrl}/repos/${repo}/issues?${issueParams}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.status}`);
      }

      const issues = await res.json();

      bugs = issues.map((issue: any) => ({
        id: this.parseSourceId(issue.number.toString(), 'github'),
        title: issue.title,
        description: issue.body,
        severity: this.normalizeSeverity(issue.labels?.find((l: any) =>
          l.name?.toUpperCase().includes('SEV') ||
          l.name?.toUpperCase().includes('PRIORITY')
        )?.name || 'Minor'),
        status: issue.state,
        source: 'github',
        sourceId: issue.number.toString(),
        labels: issue.labels.map((l: any) => l.name),
        files: this.extractFilePaths(issue.body || ''),
        commitHash: issue.pull_request?.head?.sha || issue.html_url.split('/').pop(),
        createdAt: issue.created_at,
        closedAt: issue.closed_at,
        reopenedCount: issue.reopened_count || 0,
        assignee: issue.assignee?.login,
        component: issue.labels?.find((l: any) => l.name?.startsWith('service-'))?.name,
      }));

      console.log(`✓ Ingested ${bugs.length} bugs from GitHub for ${repo}`);
    } catch (error) {
      console.error('GitHub ingestion error:', error);
      throw error;
    }

    return bugs;
  }

  /**
   * Jira Issues Ingestion
   */
  private async ingestJiraIssues(
    tracker: IssueTrackerConfig,
    options: IngestionOptions
  ): Promise<Bug[]> {
    // Simplified Jira ingestion - in production, use atlassian-jira-rest-client
    console.log('⚠ Jira ingestion stub: Add Jira API token and projectId');
    return []; // Placeholder for full implementation
  }

  /**
   * Linear Issues Ingestion
   */
  private async ingestLinearIssues(
    tracker: IssueTrackerConfig,
    options: IngestionOptions
  ): Promise<Bug[]> {
    // Simplified Linear ingestion - in production, use Linear SDK
    console.log('⚠ Linear ingestion stub: Add Linear API token and projectId');
    return []; // Placeholder for full implementation
  }

  /**
   * Azure DevOps Issues Ingestion
   */
  private async ingestAzureDevOpsIssues(
    tracker: IssueTrackerConfig,
    options: IngestionOptions
  ): Promise<Bug[]> {
    // Simplified Azure DevOps ingestion - in production, use Azure DevOps REST APIs
    console.log('⚠ Azure DevOps ingestion stub: Add ADO API token and projectId');
    return []; // Placeholder for full implementation
  }

  /* --- Utility Methods --- */

  /**
   * Get weighted bug count based on severity
   */
  getWeightedBugCount(bugCount: number, severity: Severity): number {
    const weight = this.config.weights?.[severity] || this.DEFAULT_WEIGHTS[severity];
    return bugCount * weight;
  }

  /**
   * Get merged bugs (deduplicate by sourceId)
   */
  getMergedBugs(allBugs: Bug[]): Record<string, Bug> {
    const merged = new Record<string, Bug>('');
    allBugs.forEach((bug) => {
      // Deduplicate - later sightings don't replace earlier ones to preserve historical context
      if (!merged[bug.id]) {
        merged[bug.id] = bug;
      }
    });
    return merged;
  }
}