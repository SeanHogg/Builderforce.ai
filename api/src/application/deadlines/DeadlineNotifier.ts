import type { Db } from '../../infrastructure/database/connection.js';
import type { DeadlineRepository } from '../../infrastructure/repositories/DeadlineRepository.js';
import type { DeadlineAuditStore } from './AuditLog.js';

/**
 * Deadline-specific notifications and escalation (FR-6).
 * Aligns with runAlertSweep and approvalNotifier patterns.
 *
 * Responsibilities:
 * - T-Time alerts within configurable prior days
 * - Health-change alerts (On Track → At Risk, etc.)
 * - Daily digests for status changes in the prior 24h
 * - Escalation routing when Off Track status persists
 */
export class DeadlineNotifier {
  constructor(
    private readonly deadlineRepo: DeadlineRepository,
    private readonly auditLog: DeadlineAuditStore,
  ) {}

  /**
   * Notify all deadlines approaching target date within given days.
   * FR-6: admin-configurable per deadline or type; defaults T-7 day.
   *
   * @param daysToWarn - number of days before target date to trigger.
   */
  async notifyApproaching(daysToWarn: number): Promise {
    const now = new Date();
    const warningThreshold = new Date(
      now.getTime() + daysToWarn * 24 * 60 * 60 * 1000,
    );

    // Fetch upcoming deadlines sorted by due_date ASC
    const targets = await this.deadlineRepo.list(false);
    const upcoming: Deadline[] = [];
    for (const row of targets) {
      const deadline = row; // approximate 'Deadline' conceptual for type
      // Only notify deadlines whose dueDate is between now and warningThreshold
      if (deadline.dueDate >= now && deadline.dueDate <= warningThreshold) {
        upcoming.push(deadline);
      }
    }

    // TODO: emit Slack/email/message events referencing live channels
    // (e.g., `/deadlines/approaching` mentions; need ownership.channelLink)
    for (const deadline of upcoming) {
      console.log(
        `[DeadlineNotifier] Approaching alert for "${deadline.title}" due ${deadline.dueDate.toISOString()}`,
      );
    }
  }

  /**
   * Notify when health status changes to At Risk, Off Track, or Missed.
   */
  async notifyHealthChange(deadlineId: number): Promise {
    const entry = this.auditLog.exportByDeadlineId(deadlineId);
    const relevant = entry
      .filter((evt) => evt.field === 'health_override')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (
      relevant &&
      ['at_risk', 'off_track', 'missed'].includes(
        relevant.newValue as string,
      )
    ) {
      const deadline = await this.deadlineRepo.findById(deadlineId);
      if (deadline) {
        console.log(
          `[DeadlineNotifier] Health-change alert: "${deadline.title}" → ${relevant.newValue} on ${relevant.createdAt.toISOString()}`,
        );
        // TODO: emit Slack/email/message referencing configured channels for deadline owner/stakeholders
      }
    }
  }

  /**
   * Build daily digest of deadlines with status changes in the prior 24h.
   */
  async notifyDailyDigest (tenantId: number): Promise {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Fetch audit events for tenant in the last 24h
    // NOTE: auditLog is in-memory; staging a per-tenant query via repository would improve coverage.
    // For now, we highlight scenarios present in the PRD and raise TODOs.
    console.log(
      `[DeadlineNotifier] Daily digest ready for tenant ${tenantId}. Implement per-tenant audit filtering.`,
    );
  }

  /**
   * Escalate Off Track deadlines after 24h of no logged action.
   *
   * Check for recent comments/notes on the deadline (or associated context). If no action is logged,
   * notify the owner's manager via HRIS or manual escalation sequence.
   */
  async escalateOffTrack(deadlineId: number): Promise {
    const deadline = await this.deadlineRepo.findById(deadlineId);
    if (!deadline) return;

    // Assume future enrichment with comments/notes stored on 'related:TicketId'.
    // For now, confirm this function is ready for extension once that data model exists.
    console.log(
      `[DeadlineNotifier] Escalation pending for Off Track deadline "${deadline.title}" (owner=${deadline.owner})`,
    );
    // TODO: emit escalation via HRIS; ensure test confirms escalation doesn't fire if a comment/action is logged within 24h.
  }
}

// Type imports for compile-time safety (conceptual; real handles injected at runtime)
type Deadline = {
  id: number;
  owner: string;
  title: string;
  createdAt: Date;
};