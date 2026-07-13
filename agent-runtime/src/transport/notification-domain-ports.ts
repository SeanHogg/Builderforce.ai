/**
 * Notification domain ports defined by Hen task completion feature
 *
 * These are the domain interfaces (ports) for the notification feature.
 * They define the responsibilities and contracts without knowing implementation details.
 */

/**
 * Port: Retrieves the primary email address for an account holder.
 * Single Responsibility - only account → email resolution.
 *
 * Implementations:
 * - AccountUtil (domain service) in src/utils/accounts.ts
 */
export interface AccountEmailResolver {
  /**
   * @returns The primary email for the account, or `null` if unknown.
   */
  getPrimaryEmail(accountId: string): Promise<string | null>;
}

/**
 * Port: Sends an email notification.
 * Single Responsibility - only email dispatch.
 *
 * Implementations:
 * - ResendEmailNotifier (infrastructure adapter) in agent-runtime/extensions/llm-task/src/hen-task-completion-notifier.ts
 * - MockEmailNotifier (for testing)
 */
export interface EmailNotifier {
  /**
   * Send an email notification.
   * @returns `true` if the send succeeded, `false` otherwise.
   */
  send(to: string, subject: string, html: string): Promise<boolean>;
}

/**
 * Notification log entry for auditing (FR.5).
 *
 * Used by the domain service to track notification attempts.
 */
export type NotificationLogEntry = {
  accountId: string;
  email: string;
  subject: string;
  sentAt: Date;
  success: boolean;
  errorMessage?: string;
};