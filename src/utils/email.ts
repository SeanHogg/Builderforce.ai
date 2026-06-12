import { Logger } from "./logging";

const logger = new Logger("EmailService");

export interface EmailOptions {
	to: string;
	subject: string;
	body: string;
	// Potentially add more fields like cc, bcc, htmlBody, attachments, etc.
}

/**
 * A utility class for sending emails.
 * This is a placeholder and should be replaced with an actual email sending implementation
 * (e.g., using a third-party email API like SendGrid, Nodemailer, AWS SES).
 */
export class EmailService {
	constructor() {
		logger.info("EmailService initialized. (Placeholder - no actual email sending configured)");
	}

	/**
	 * Sends an email.
	 * @param options - The email details.
	 * @returns Promise<void>
	 */	public async send(options: EmailOptions): Promise<void> {
		logger.info("Simulating email send:", {
			to: options.to,
			subject: options.subject,
			bodyPreview: options.body.substring(0, 100) + (options.body.length > 100 ? "..." : ""),
		});

		// TODO: Replace this with actual email sending logic using a robust email provider.
		// Example using a hypothetical email client:
		// await this.emailClient.send({ to: options.to, subject: options.subject, html: options.body });

		// For now, simulate a delay and potential error for testing purposes
		await new Promise(resolve => setTimeout(resolve, Math.random() * 1000)); // Simulate network delay

		if (Math.random() < 0.05) { // Simulate a 5% chance of failure
			throw new Error("Simulated email send failure.");
		}

		logger.info(`Simulated email to ${options.to} sent successfully.`);
	}
}
