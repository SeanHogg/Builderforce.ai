/**
 * Weekly Digest Configuration
 * 
 * Defines the digest window, templates, and distribution list for
 * the app-level weekly digest generation system.
 * 
 * Implements FR3.4 (Digest Configuration)
 */

import type {
  WeeklyDigestConfig,
  DigestWindow,
  DigestTemplate,
  DistributionMethod
} from '../../types/dashboard';

/**
 * Default weekly digest configuration (FR3.4)
 */
export const DEFAULT_DIGEST_CONFIG: WeeklyDigestConfig = {
  enabled: true,
  digestWindow: {
    start: 'monday',
    end: 'friday',
    windowName: 'weekly'
  },
  distributionList: {
    requiredApprovers: [],
    informedPartyEmails: [],
    slackChannels: ['#stakeholder-updates']
  },
  template: {
    subject: 'Weekly Stakeholder Alignment Digest - {period}',
    bodyFormat: 'markdown',
    sections: {
      summary: 'Key metrics summary for {period}',
      topConflicts: 'Top 2 Conflicts and Overdue Items',
      urgentItems: 'Urgent Action Items'
    }
  },
  maxLength: 600 // Approximate character limit (FR2.2)
};

/**
 * Digest content builder (FR2.2)
 * Generates lightweight digest content (~600 characters)
 */
export class DigestContentBuilder {
  private config: WeeklyDigestConfig;

  constructor(config: WeeklyDigestConfig = DEFAULT_DIGEST_CONFIG) {
    this.config = config;
  }

  /**
   * Generate digest content from metrics
   */
  generate(
    metrics: {
      totalOpenSignOffs: number;
      pendingEscalations: number;
      topConflicts: Array<{ id: string; title: string; priority: string; severity: string }>;
      urgentActionItems: Array<{ id: string; title: string; priority: string; targetDate: string }>;
    },
    period: string
  ): string {
    const lines: string[] = [];

    // Summary section
    const summaryText = `${this.formatNumber(metrics.totalOpenSignOffs)} open sign-offs, ${metrics.pendingEscalations} pending escalations — see dashboard for details.`;
    if (summaryText.length <= this.config.maxLength) {
      lines.push(summaryText);
    }

    // Top conflicts section (top 2)
    if (metrics.topConflicts.length > 0) {
      const conflictItems = metrics.topConflicts.slice(0, 2).map(conflict => 
        `- **${conflict.title}** (${conflict.priority}): ${conflict.severity}`
      ).join('\n');
      
      const topConflictsText = `${this.config.template.sections.topConflicts}:\n${conflictItems}`;
      if ((lines.length === 0 ? 0 : lines.reduce((acc, l) => acc + l.length, 0)) + topConflictsText.length <= this.config.maxLength) {
        lines.push(topConflictsText);
      }
    }

    // Urgent action items section
    if (metrics.urgentActionItems.length > 0) {
      const urgentItems = metrics.urgentActionItems.map(item =>
        `- **${item.title}** (due: ${item.targetDate}): ${item.priority}`
      ).join('\n');
      
      const urgentItemsText = `${this.config.template.sections.urgentItems}:\n${urgentItems}`;
      const totalLength = lines.reduce((acc, l) => acc + l.length, 0);
      if (totalLength === 0 || totalLength + urgentItemsText.length <= this.config.maxLength) {
        lines.push(urgentItemsText);
      }
    }

    return lines.filter(line => line.trim()).join('\n\n');
  }

  /**
   * Format a number for display
   */
  private formatNumber(num: number): string {
    return num.toString();
  }
}

/**
 * Distribution list manager (FR3.7)
 */
export class DistributionListManager {
  private config: WeeklyDigestConfig;

  constructor(config: WeeklyDigestConfig = DEFAULT_DIGEST_CONFIG) {
    this.config = config;
  }

  /**
   * Get complete distribution list
   */
  getDistributionList(): Set<string> {
    const set = new Set<string>();
    
    if (this.config.distributionList.requiredApprovers) {
      this.config.distributionList.requiredApprovers.forEach(email => set.add(`email:${email}`));
    }
    
    if (this.config.distributionList.informedPartyEmails) {
      this.config.distributionList.informedPartyEmails.forEach(email => set.add(`email:${email}`));
    }
    
    return set;
  }

  /**
   * Get distribution methods
   */
  getDistributionMethods(): DistributionMethod[] {
    const methods: DistributionMethod[] = [];
    
    if (this.config.distributionList.requiredApprovers?.length > 0) {
      methods.push('email');
    }
    
    if (this.config.distributionList.informedPartyEmails?.length > 0) {
      methods.push('email');
    }
    
    if (this.config.distributionList.slackChannels?.length > 0) {
      methods.push('slack');
    }
    
    if (methods.length === 0) {
      // Default to both if no channels configured
      return ['email', 'slack'];
    }
    
    return methods;
  }

  /**
   * Get recipient types
   */
  getRecipientTypes(): ('requiredApprovers' | 'informedPartyEmails' | 'slackChannels')[] {
    const types: ('requiredApprovers' | 'informedPartyEmails' | 'slackChannels')[] = [];
    
    if (this.config.distributionList.requiredApprovers?.length > 0) {
      types.push('requiredApprovers');
    }
    
    if (this.config.distributionList.informedPartyEmails?.length > 0) {
      types.push('informedPartyEmails');
    }
    
    if (this.config.distributionList.slackChannels?.length > 0) {
      types.push('slackChannels');
    }
    
    return types;
  }
}

/**
 * Save digest configuration to persistent storage
 */
export async function saveDigestConfig(config: WeeklyDigestConfig): Promise<boolean> {
  try {
    // In production, this would save to a database or config file
    localStorage.setItem('digest-config', JSON.stringify(config));
    return true;
  } catch (error) {
    console.error('Failed to save digest config:', error);
    return false;
  }
}

/**
 * Load digest configuration from persistent storage
 */
export async function loadDigestConfig(): Promise<WeeklyDigestConfig> {
  try {
    const stored = localStorage.getItem('digest-config');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('Failed to load digest config:', error);
  }
  
  return DEFAULT_DIGEST_CONFIG;
}