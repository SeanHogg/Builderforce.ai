import { z } from "zod";
import { type NotificationService } from "../../src/services/notificationService";
import { type AccountUtil } from "../../src/utils/accounts"; // Corrected import
import { type TaskCompletionEvent } from "../../src/types/task"; // Assuming TaskCompletionEvent type exists
import { Logger } from "../../src/utils/logging"; // Assuming Logger utility exists

const logger = new Logger("HenTaskCompletionNotifier");

export const HenTaskCompletionNotifierSchema = z.object({
	platformName: z.string().default("Platform Name"), // To be configured or set globally
});

type HenTaskCompletionNotifierConfig = z.infer<typeof HenTaskCompletionNotifierSchema>;

export class HenTaskCompletionNotifier {
	private config: HenTaskCompletionNotifierConfig;
	private notificationService: NotificationService;
	private accountUtil: AccountUtil; // Changed from AccountService to AccountUtil

	constructor(
		config: HenTaskCompletionNotifierConfig,
		notificationService: NotificationService,
		accountUtil: AccountUtil // Changed from AccountService to AccountUtil
	) {
		this.config = HenTaskCompletionNotifierSchema.parse(config);
		this.notificationService = notificationService;
		this.accountUtil = accountUtil; // Assign the AccountUtil instance
	}

	/**
	 * Handles the event when a Hen task is completed.
	 * Checks if it was the last task for the account and triggers an email notification if so.
	 * @param event - The task completion event.
	 */
	public async handleTaskCompletion(event: TaskCompletionEvent): Promise<void> {
		logger.info(`Received task completion event for task ID: ${event.taskId}, Account ID: ${event.accountId}`);

		try {
			// 1. Check if this was the lastHen task for the account
			const isLastTask = await this.isLastHenTaskForAccount(event.accountId, event.taskId);

			if (isLastTask) {
				logger.info(`All Hen tasks for account ${event.accountId} are now complete. Triggering email notification.`);

				// 2. Retrieve account holder's primary email using AccountUtil
				const accountHolderEmail = await this.getAccountHolderEmail(event.accountId);

				if (accountHolderEmail) {
					// 3. Generate email content
					const emailSubject = "Your Hen Tasks are Complete!";
					const emailBody = `Good news! All Hen tasks for your account are now complete. Log in to ${this.config.platformName} to view details and next steps. Thank you for using our service!`;

					// 4. Send the email notification
					await this.notificationService.sendEmail({
						to: accountHolderEmail,
						subject: emailSubject,
						body: emailBody,
					});
					logger.info(`Email notification sent successfully to ${accountHolderEmail} for account ${event.accountId}.`);

					// Log the successful notification attempt with accountId and taskId
					await this.notificationService.logNotificationAttempt({
						accountId: event.accountId,
						taskId: event.taskId,
						channel: "email",
						status: "sent",
					});
				} else {
					logger.warn(`Could not retrieve email for account ${event.accountId}. Skipping email notification.`);
					// Log this as a potential issue even if not an error
					await this.notificationService.logNotificationAttempt({
						accountId: event.accountId,
						taskId: event.taskId,
						channel: "email",
						status: "failed",
						reason: "Account holder email not found",
					});
				}
			} else {
				logger.debug(`Task ${event.taskId} completion does not mark the completion of all Hen tasks for account ${event.accountId}.`);
			}
		} catch (error) {
			logger.error(`Failed to handle task completion for account ${event.accountId}, task ${event.taskId}:`, error);
			// Log the failure
			await this.notificationService.logNotificationAttempt({
				accountId: event.accountId,
				taskId: event.taskId,
				channel: "email",
				status: "failed",
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Checks if the given task is the last Hen task for the specified account.
	 * This is a placeholder and needs to be implemented using actual data fetching.
	 * @param accountId - The ID of the account.
	 * @param completedTaskId - The ID of the task that was just completed.
	 * @returns Promise<boolean> - True if it's the last Hen task, false otherwise.
	 */
	private async isLastHenTaskForAccount(accountId: string, completedTaskId: string): Promise<boolean> {
		// TODO: Implement actual logic to check task status for the account.
		// This would involve querying the task management system.
		// For now, assume it's the last task to allow testing the email flow.
		logger.debug(`Checking if task ${completedTaskId} is the last Hen task for account ${accountId}... (placeholder logic)`);
		// In a real scenario, you would fetch all tasks for the account, filter for 'Hen' tasks,
		// and check if all of them are in a 'Complete' state:
		// const accountTasks = await this.accountUtil.getAccountTasks(accountId); // Assuming AccountUtil has this method
		// const henTasks = accountTasks.filter(task => task.type === 'Hen');
		// return henTasks.every(task => task.status === 'Complete');

		// Placeholder: Mocking it to return true for demonstration purposes
		return true;
	}

	/**
	 * Retrieves the primary email address for a given account ID using AccountUtil.
	 * @param accountId - The ID of the account.
	 * @returns Promise<string | null> - The account holder's email address or null if not found.
	 */
	private async getAccountHolderEmail(accountId: string): Promise<string | null> {
		logger.debug(`Retrieving primary email for account ${accountId}...`);
		try {
			const account = await this.accountUtil.getAccountById(accountId); // Use AccountUtil
			if (!account || !account.primaryEmail) {
				logger.warn(`Account ${accountId} not found or has no primary email.`);
				return null;
			}
			return account.primaryEmail;
		} catch (error) {
			logger.error(`Error retrieving account ${accountId}:`, error);
			return null;
		}
	}
}
