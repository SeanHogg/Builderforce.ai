/**
 * Weekly Digest Worker
 *
 * An app-level worker that auto-generates weekly digests daily.
 * Generates lightweight (~600 chars) digests with:
 * - Top 2 most active conflicts/overdue items
 * - Count summary of relevant metrics
 * - List of urgent/pending action items
 *
 * Implements FR2.1, FR2.2, FR3.5, FR3.6, FR3.7
 */

import type {
  WeeklyDigest,
  DigestMetrics,
  WeeklyDigestConfig,
  DistributionMethod,
} from '@builderforce/shared/types/dashboard';

/**
 * Storage interface for digest persistence and paging
 */
interface DigestStorage {
  saveDigest(digest: WeeklyDigest): Promise<void>;
  getLatestDigest(): Promise<WeeklyDigest | null>;
  getDigestsByProject(projectId: string): Promise<WeeklyDigest[]>;
  getDigestHistory(days: number): Promise<WeeklyDigest[]>;
}

/**
 * Digest generation result
 */
interface DigestGenerationResult {
  success: boolean;
  digest?: WeeklyDigest;
  error?: string;
}

/**
 * Weekly digest worker class
 */
export class WeeklyDigestWorker {
  private config: WeeklyDigestConfig;
  private storage: DigestStorage;

  constructor(config: WeeklyDigestConfig, storage: DigestStorage) {
    this.config = config;
    this.storage = storage;
  }

  /**
   * Check if the worker should run today
   */
  private shouldRunToday(): boolean {
    const now = new Date();
    const start = this.config.digestWindow.start;
    const end = this.config.digestWindow.end;

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const currentDay = dayNames[now.getDay()];

    return currentDay === start || currentDay === end;
  }

  /**
   * Generate digest with configured content constraints (FR2.2)
   */
  async generateDigest(): Promise<DigestGenerationResult> {
    try {
      // In production, this would fetch real metrics:
      // - Open sign-offs count
      // - Pending escalations count
      // - Top 2 active conflicts/overdue items from conflict detection
      // - U/pending action items from task management

      // Mock metrics for demo
      const metrics: DigestMetrics = {
        totalOpenSignOffs: 23,
        pendingEscalations: 4,
        topConflicts: [
          {
            id: 'conflict_001',
            title: 'Priority Conflict in Customer Experience Platform',
            priority: 'P0',
            severity: 'Critical',
          },
          {
            id: 'conflict_002',
            title: 'Resource Allocation Disagreement',
            priority: 'P1',
            severity: 'High',
          },
        ],
        urgentActionItems: [
          {
            id: 'task_001',
            title: 'Resolve priority conflict for Customer Experience Platform',
            priority: 'Urgent',
            targetDate: '2025-06-20',
          },
          {
            id: 'task_002',
            title: 'Approve pending sign-offs for AI Agent Training',
            priority: 'High',
            targetDate: '2025-06-21',
          },
          {
            id: 'task_003',
            title: 'Address escalation #489 in Performance Dashboard',
            priority: 'Medium',
            targetDate: '2025-06-22',
          },
        ],
      };

      // Get distribution methods from config
      const distributionMethods = this.getDistributionMethods();

      // Build digest content (FR2.2 - ~600 chars)
      const digestContent = this.buildDigestContent(metrics);

      // Create digest object
      const digest: WeeklyDigest = {
        digestId: `digest_${Date.now()}`,
        generatedAt: new Date().toISOString(),
        recipients: [], // Will be populated when distributed
        content: digestContent,
        metrics,
      };

      // Persist digest
      await this.storage.saveDigest(digest);

      return {
        success: true,
        digest,
      };
    } catch (error) {
      console.error('Digest generation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Build digest content respecting ~600 character limit (FR2.2)
   */
  private buildDigestContent(metrics: DigestMetrics): string {
    const lines: string[] = [];
    let totalLength = 0;

    // Summary section
    const summaryText = `📊 ${metrics.totalOpenSignOffs} open sign-offs, ${metrics.pendingEscalations} pending escalations — full view: /dashboard`;
    if (summaryText.length <= this.config.maxLength) {
      lines.push(summaryText);
      totalLength += summaryText.length + 2; // +2 for newline
    }

    // Top conflicts section (top 2 only)
    if (metrics.topConflicts.length > 0) {
      const conflictItems = metrics.topConflicts
        .map(conflict => `- ${conflict.title} (${conflict.priority})`)
        .join('\n');
      const topConflictsText = `\n\n🔴 ${this.config.template.sections.topConflicts}:\n${conflictItems}`;
      if (totalLength + topConflictsText.length <= this.config.maxLength) {
        lines.push(topConflictsText);
        totalLength += topConflictsText.length;
      }
    }

    // Urgent action items
    if (metrics.urgentActionItems.length > 0) {
      const urgentItems = metrics.urgentActionItems
        .map(item => `- ${item.title} (due: ${item.targetDate})`)
        .join('\n');
      const urgentItemsText = `\n\n⚠️ ${this.config.template.sections.urgentItems}:\n${urgentItems}`;
      if (totalLength + urgentItemsText.length <= this.config.maxLength) {
        lines.push(urgentItemsText);
      }
    }

    return lines.filter(line => line.trim()).join('');
  }

  /**
   * Get available distribution methods from configuration
   */
  private getDistributionMethods(): DistributionMethod[] {
    const methods: DistributionMethod[] = [];

    // Check if email distribution is configured
    const hasEmailRecipients =
      (this.config.distributionList.requiredApprovers?.length ?? 0) > 0 ||
      (this.config.distributionList.informedPartyEmails?.length ?? 0) > 0;

    if (hasEmailRecipients) {
      methods.push('email');
    }

    // Check if Slack is configured
    if ((this.config.distributionList.slackChannels?.length ?? 0) > 0) {
      methods.push('slack');
    }

    return methods.length > 0 ? methods : ['email'];
  }

  /**
   * Run the digest generation and distribution
   */
  async run(): Promise<DigestGenerationResult> {
    if (!this.config.enabled) {
      return {
        success: true,
        error: 'Digest generation is disabled in configuration',
      };
    }

    if (!this.shouldRunToday()) {
      return {
        success: true,
        error: 'Not a configured digest day',
      };
    }

    // Generate digest content
    const generationResult = await this.generateDigest();
    if (!generationResult.success) {
      return generationResult;
    }

    // Distribute digest (FR2.3)
    const distributionResult = await this.distributeDigest(generationResult.digest!);

    return {
      success: distributionResult.success,
      digest: generationResult.digest,
      error: distributionResult.error,
    };
  }

  /**
   * Distribute digest via configured channels (FR2.3)
   */
  private async distributeDigest(digest: WeeklyDigest): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      // Calculate distribution recipients
      const allEmails = [
        ...this.config.distributionList.requiredApprovers!,
        ...this.config.distributionList.informedPartyEmails!,
      ];

      const recipients = allEmails.filter((email, index, self) => self.indexOf(email) === index);

      // Get distribution methods
      const methods = this.getDistributionMethods();

      // Distribute via each method
      for (const method of methods) {
        if (method === 'email') {
          for (const email of recipients) {
            // In production, send email via configured email service
            await this.sendEmail(email, digest, method);
          }
        } else if (method === 'slack') {
          for (const channel of this.config.distributionList.slackChannels!) {
            await this.sendSlack(channel, digest);
          }
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Digest distribution failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send digest via email
   */
  private async sendEmail(recipient: string, digest: WeeklyDigest, method: 'email'): Promise<void> {
    // In production, integrate with email service (SendGrid, AWS SES, etc.)
    const { subject, bodyFormat, sections } = this.config.template;
    const emailSubject = subject.replace('{period}', 'This Week');

    // Format body based on template
    let emailBody = '';
    if (bodyFormat === 'markdown') {
      emailBody = `# ${emailSubject}\n\n${digest.content}\n\n---\n*View full metrics: https://builderforce.ai/dashboard*`;
    } else if (bodyFormat === 'plain') {
      emailBody = `${emailSubject}\n\n${digest.content}\n\n---\nView full metrics: https://builderforce.ai/dashboard`;
    } else {
      emailBody = `<h1>${emailSubject}</h1><pre>${digest.content}</pre><hr><p><a href="https://builderforce.ai/dashboard">View full metrics</a></p>`;
    }

    console.log(`[Digest Worker] Sending email to ${recipient}:`, emailSubject.slice(0, 50) + '...');
    // await emailService.send({ to: recipient, subject: emailSubject, body: emailBody });
  }

  /**
   * Send digest via Slack
   */
  private async sendSlack(channel: string, digest: WeeklyDigest): Promise<void> {
    // In production, integrate with Slack API
    console.log(`[Digest Worker] Posting to Slack channel ${channel}:`, digest.content.slice(0, 200) + '...');
    // await slackService.postMessage({ channel, text: digest.content, attachments: ... });
  }
}