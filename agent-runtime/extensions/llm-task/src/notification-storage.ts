/**
 * Storage for tracking Hen task completion notifications.
 *
 * Responsibility:
 * 1. Track which accounts have already received "all tasks complete" notifications (AC.5)
 * 2. Prevent duplicate notifications for the same event
 */

interface PreviouslyNotifiedAccount {
  accountId: string;
  notifiedAt: Date;
  lastTaskId: string;
}

/**
 * Storage for notification tracking.
 * In-memory storage for notification tracking.
 * In production, this would be persisted to a database.
 */
export class NotificationStorage {
  private notifications = new Map<string, PreviouslyNotifiedAccount>();

  /**
   * Check if an account has already been notified about all tasks being complete.
   *
   * @param accountId - The account ID to check
   * @returns true if already notified, false otherwise
   */
  hasNotified(accountId: string): boolean {
    return this.notifications.has(accountId);
  }

  /**
   * Mark an account as notified and store the event details.
   *
   * @param accountId - The account ID to mark as notified
   * @param lastTaskId - The ID of the task that completed the batch (last Hen task)
   * @returns true if marking was successful
   */
  markNotified(accountId: string, lastTaskId: string): boolean {
    this.notifications.set(accountId, {
      accountId,
      notifiedAt: new Date(),
      lastTaskId,
    });
    return true;
  }

  /**
   * Get notification details for an account.
   *
   * @param accountId - The account ID to retrieve
   * @returns PreviouslyNotifiedAccount | undefined
   */
  getNotification(accountId: string): PreviouslyNotifiedAccount | undefined {
    return this.notifications.get(accountId);
  }

  /**
   * Clear notification storage (useful for testing or administration).
   */
  clear(): void {
    this.notifications.clear();
  }

  /**
   * Get total count of notified accounts (useful for monitoring).
   *
   * @returns Number of accounts that have been notified
   */
  getCount(): number {
    return this.notifications.size;
  }
}

// Export singleton instance
export const notificationStorage = new NotificationStorage();