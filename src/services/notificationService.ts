import { type EmailService } from "../utils/email"; // Assuming EmailService is in utils/email.ts
import { type Logger } from "../utils/logging"; // Assuming Logger is in utils/logging.ts
import { type AccountUtil } from "../utils/accounts"; // Assuming AccountUtil is in utils/accounts.ts

// Define types for clarity
export interface EmailOptions {
	to: string;
	subject: string;
	body: string;
}

export interface NotificationLogEntry {
	accountId: string;
	taskId?: string; // Optional: if the notification is related to a specific task
	channel: "email" | "sms" | "in_app"; // Extended for future use
	status: "sent" | "failed" | "pending";
	reason?: string; // For failures or more details
	timestamp: Date;
}

export class NotificationService {
	private emailService: EmailService;
	private logger: Logger;
	private accountUtil: AccountUtil; // Used here to potentially get account details for logging if needed

	constructor(emailService: EmailService, logger: Logger, accountUtil: AccountUtil) {
		this.emailService = emailService;
		this.logger = logger.child("NotificationService"); // Create a child logger for this service
		this.accountUtil = accountUtil;
	}

	/**
	 * Sends an email notification.
	 * @param options - The email content and recipient.
	 * @returns Promise<void>
	 */
	public async sendEmail(options: EmailOptions): Promise<void> {
		this.logger.debug(`Sending email to ${options.to} with subject: ${options.subject}`);
		try {
			await this.emailService.send(options);
			this.logger.info(`Email sent successfully to ${options.to}.`);
			// Log the successful attempt
			await this.logNotificationAttempt({
				accountId: "unknown", // Determine accountId if possible, otherwise keep as unknown
				channel: "email",
				status: "sent",
				// taskId is not directly available here, might need to be passed if relevant
			});
		} catch (error) {
			this.logger.error(`Failed to send email to ${options.to}:`, error);
			// Log the failed attempt
			await this.logNotificationAttempt({
				accountId: "unknown", // Determine accountId if possible
				channel: "email",
				status: "failed",
				reason: error instanceof Error ? error.message : String(error),
			});
			throw error; // Re-throw the error to be handled by the caller
		}
	}

	/**
	 * Logs an attempt to send a notification.
	 * This is a placeholder for actual logging (e.g., to a database or file).
	 * @param logEntry - Details of the notification attempt.
	 * @returns Promise<void>
	 */
	public async logNotificationAttempt(logEntry: Omit<NotificationLogEntry, 'timestamp' | 'accountId' | 'taskId'> & Partial<Pick<NotificationLogEntry, 'accountId' | 'taskId'>>): Promise<void> {
		const fullLogEntry: NotificationLogEntry = {
			...logEntry,
			timestamp: new Date(),
			accountId: logEntry.accountId ?? "unknown", // Default to unknown if not provided
			taskId: logEntry.taskId ?? undefined,
		};
		this.logger.info(`Notification Log: Channel=${fullLogEntry.channel}, Status=${fullLogEntry.status}, AccountID=${fullLogEntry.accountId}, TaskID=${fullLogEntry.taskId ?? 'N/A'}, Reason=${fullLogEntry.reason ?? 'N/A'}`);

		// TODO: Implement actual persistent logging (e.g., to a database, file, or dedicated logging service)
		// For now, we are just logging to the console via the logger.
	}

	/**
	 * Fetches account details, potentially populating accountId in log entries.
	 * This is a placeholder method.
	 */
	private async populateAccountIdIfMissing(logEntry: Omit<NotificationLogEntry, 'timestamp' | 'accountId' | 'taskId'> & Partial<Pick<NotificationLogEntry, 'accountId' | 'taskId'>>): Promise<string> {
		if (logEntry.accountId && logEntry.accountId !== "unknown") {
			return logEntry.accountId;
		}
		// In a real implementation, you might try to infer the accountId
		// from the context of the event that triggered the notification.
		// For example, if the sendEmail method is called with an accountId.
		// For now, we return 'unknown'.
		return "unknown";
	}
}
