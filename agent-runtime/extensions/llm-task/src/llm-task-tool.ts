import { z } from "zod";
import { type LLMTask } from "@builderforce/llm-agent";
import { HenTaskCompletionNotifier, type HenTaskCompletionNotifierConfig } from "./hen-task-completion-notifier.js";
import { type AccountUtil } from "../../../src/utils/accounts.js";
import type { TaskStorage } from "../../../src/transport/task-engine.js";
import type { TaskStatus } from "../../../src/transport/types.js";

/**
 * Configuration schema for the Hen Task Completion Notifier.
 */
export const HenTaskCompletionNotifierSchema = z.object({
  enabled: z.boolean().default(true),
  resendApiKey: z.string().optional(),
  platformName: z.string().default("Builderforce"),
  platformLoginUrl: z.string().default("https://builderforce.ai"),
  storage: z.any(), // TaskStorage instance for definitive count
});

type LLMTaskExtensionConfig = z.infer<typeof HenTaskCompletionNotifierSchema>;

/**
 * LLM Task Tool Extension
 *
 * Provides task-related functionalities like completion notification.
 *
 * Usage:
 * 1. Create an AccountUtil instance
 * 2. Create a HenTaskCompletionNotifier using a Resend adapter (if apiKey is available)
 * 3. Register the tool with an LLMTask instance
 */

export class LLMTaskTool {
  private config: LLMTaskExtensionConfig;
  private notificationService?: HenTaskCompletionNotifier;
  private accountUtil: AccountUtil;
  private completedAccountIds = new Set<string>(); // Track notified accounts to prevent duplicates
  private storage?: TaskStorage;

  constructor(config: LLMTaskExtensionConfig, accountUtil: AccountUtil) {
    this.config = HenTaskCompletionNotifierSchema.parse(config);
    this.accountUtil = accountUtil;
    this.storage = config.storage;

    this.initializeNotifier();
  }

  /**
   * Initialize the Hen task completion notifier using the domain service.
   * Uses the Resend EmailNotifier adapter when an API key is available.
   */
  private initializeNotifier(): void {
    this.notificationService = HenTaskCompletionNotifier.createResend(
      this.config.resendApiKey ?? "",
      this.config.platformName,
      this.config.platformLoginUrl,
      this.config.enabled
    );

    console.log("[LLMTaskTool] HenTaskCompletionNotifier initialized.");
  }

  /**
   * Registers the tool's event handlers on the LLMTask instance.
   *
   * @param llmTask - The LLMTask instance to register handlers with.
   */
  public register(llmTask: LLMTask): void {
    console.log("[LLMTaskTool] Registering event handlers...");

    // Register handler for task status change events (FR.1 - Hen task completion detection)
    llmTask.onTaskStatusChange(async (event) => {
      console.debug("[LLMTaskTool] Received TaskStatusChangeEvent:", event);

      if (!this.notificationService || !this.storage) {
        console.warn("[LLMTaskTool] HenTaskCompletionNotifier not initialized or storage unavailable. Cannot handle task completion.");
        return;
      }

      try {
        if (!event.accountId) {
          console.warn("[LLMTaskTool] Task status change event missing accountId. Cannot notify account.");
          return;
        }

        // Only react to completed Hen tasks
        if (event.taskId && event.oldStatus !== "completed" && event.newStatus === "completed") {
          await this.handleHenTaskCompletion(event.taskId, event.accountId);
        }
      } catch (error) {
        console.error("[LLMTaskTool] Error in HenTaskCompletionNotifier during task status change:", error);
      }
    });

    console.log("[LLMTaskTool] Event handlers registered successfully.");
  }

  /**
   * Handles a Hen task completion event by checking if ALL Hen tasks for the account are now complete.
   * If so, sends the notification email only once (AC.1 and AC.5).
   */
  private async handleHenTaskCompletion(taskId: string, accountId: string): Promise<void> {
    const accountHolderEmail = await this.accountUtil.getPrimaryEmail(accountId);

    if (!accountHolderEmail) {
      console.warn(
        `[LLMTaskTool] Could not retrieve email for account ${accountId}. Skipping email notification.`
      );
      console.warn(
        `[LLMTaskTool] Ensure AccountUtil.getAccountById() returns primaryEmail for account ${accountId}`
      );
      return;
    }

    // FR.4: Check if this is the LAST Hen task for the account by verifying all Hen tasks are completed
    const allHenTasksCompleted = await this.areAllHenTasksCompleted(accountId);

    if (!allHenTasksCompleted) {
      // Still waiting for other Hen tasks to complete - no notification
      console.debug(
        `[LLMTaskTool] Account ${accountId} has ${this.getPendingHenTaskCount(accountId)} Hen tasks remaining. Not sending notification yet.`
      );
      return;
    }

    // AC.5: Prevent duplicate notifications for the same "all tasks complete" event
    const accountKey = `${accountId}:${this.config.platformName}`;
    if (this.completedAccountIds.has(accountKey)) {
      console.debug(
        `[LLMTaskTool] Account ${accountId} already notified of all Hen tasks completion. Skipping duplicate notification.`
      );
      return;
    }

    // Send the notification (FR.3, FR.4, FR.5)
    console.log(
      `[LLMTaskTool] All Hen tasks for account ${accountId} are now complete. Sending notification email to ${accountHolderEmail}.`
    );

    const logEntry = await this.notificationService.notify(accountId, accountHolderEmail);

    // Track that we've sent the notification for this account
    this.completedAccountIds.add(accountKey);

    if (logEntry.success) {
      console.log(`[LLMTaskTool] ✅ Notification sent successfully for account ${accountId}`);
    } else {
      console.error(`[LLMTaskTool] ❌ Failed to send notification for account ${accountId}: ${logEntry.errorMessage}`);
    }
  }

  /**
   * Checks if all Hen tasks for the given account are completed.
   */
  private async areAllHenTasksCompleted(accountId: string): Promise<boolean> {
    const allTasks = await this.storage?.list() ?? [];
    
    const accountHenTasks = allTasks.filter(
      (t) => t.accountId === accountId && this.isHenTask(t)
    );

    // If there are no Hen tasks for this account, consider it completed (meet-the-scope)
    if (accountHenTasks.length === 0) {
      return true;
    }

    // Check if all found Hen tasks are completed
    return accountHenTasks.every((t) => t.status === "completed");
  }

  /**
   * Gets the count of pending (not completed) Hen tasks for the given account.
   */
  private getPendingHenTaskCount(accountId: string): number {
    const allTasks = this.storage?.list() ?? [];
    const accountHenTasks = allTasks.filter(
      (t) => t.accountId === accountId && this.isHenTask(t)
    );

    return accountHenTasks.filter((t) => t.status !== "completed").length;
  }

  /**
   * Helper to check if a task is a 'Hen' task based on taskType metadata.
   */
  private isHenTask(task: { taskType?: string }): boolean {
    return task.taskType === "Hen";
  }

  /**
   * Get the notification service for testing or custom uses.
   */
  public getNotificationService(): HenTaskCompletionNotifier | undefined {
    return this.notificationService;
  }
}