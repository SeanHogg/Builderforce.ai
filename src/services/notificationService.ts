import { sendEmail } from '../utils/email'; // Assuming an email utility function exists
import { getAccountEmail } from '../utils/accounts'; // Assuming an account utility function exists
import { logNotificationAttempt } from '../utils/logging'; // Assuming a logging utility function exists

const PLATFORM_NAME = "BuilderForce"; // To be replaced with actual platform name

/**
 * Sends an email notification to the account holder when all Hen tasks are complete.
 *
 * @param accountId - The ID of the account for which tasks are completed.
 */
export async function sendHenTaskCompletionEmail(accountId: string): Promise<void> {
  try {
    const emailAddress = await getAccountEmail(accountId);
    if (!emailAddress) {
      await logNotificationAttempt(accountId, 'hen_task_completion', 'failure', 'Account email not found');
      console.error(`Could not send Hen task completion email: Account email not found for account ${accountId}`);
      return;
    }

    const subject = "Your Hen Tasks are Complete!";
    const body = `Good news! All Hen tasks for your account are now complete. Log in to ${PLATFORM_NAME} to view details and next steps. Thank you for using our service!`;

    await sendEmail({
      to: emailAddress,
      subject: subject,
      body: body,
    });

    await logNotificationAttempt(accountId, 'hen_task_completion', 'success', 'Email sent successfully');
    console.log(`Successfully sent Hen task completion email to ${emailAddress} for account ${accountId}`);

  } catch (error) {
    await logNotificationAttempt(accountId, 'hen_task_completion', 'failure', `Error sending email: ${error.message}`);
    console.error(`Failed to send Hen task completion email for account ${accountId}:`, error);
  }
}
