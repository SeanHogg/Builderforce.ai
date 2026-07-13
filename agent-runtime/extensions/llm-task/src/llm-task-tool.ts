import { z } from "zod";
import { type LLMTask } from "@builderforce/llm-agent";
import { HenTaskCompletionNotifier, type HenTaskCompletionNotifierConfig } from "./hen-task-completion-notifier.js";
import { type AccountUtil, type Account } from "../../../src/utils/accounts.js";
import { type NotificationLogEntry } from "../transport/types.js";

/**
 * Configuration schema for the Hen Task Completion Notifier.
 */
export const HenTaskCompletionNotifierSchema = z.object({
  enabled: z.boolean().default(true),
  resendApiKey: z.string().optional(),
  platformName: z.string().default("Builderforce"),
  platformLoginUrl: z.string().default("https://builderforce.ai"),
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

  constructor(config: LLMTaskExtensionConfig, accountUtil: AccountUtil) {
    this.config = HenTaskCompletionNotifierSchema.parse(config);
    this.accountUtil = accountUtil;

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

    // Register handler for task completion events (FR.1 - Hen task completion detection)
    llmTask.onTaskComplete(async (event) => {
      console.debug("[LLMTaskTool] Received TaskCompletionEvent:", event);

      if (!this.notificationService) {
        console.warn("[LLMTaskTool] HenTaskCompletionNotifier not initialized. Cannot handle task completion.");
        return;
      }

      try {
        if (!event.accountId) {
          console.warn("[LLMTaskTool] Task completion event missing accountId. Cannot notify account.");
          return;
        }

        // FR.2: Retrieve account holder's primary email
        const accountHolderEmail = await this.accountUtil.getPrimaryEmail(event.accountId);

        if (!accountHolderEmail) {
          console.warn(
            `[LLMTaskTool] Could not retrieve email for account ${event.accountId}. Skipping email notification.`
          );
          console.warn(
            `[LLMTaskTool] Ensure AccountUtil.getAccountById() returns primaryEmail for account ${event.accountId}`
          );
          return;
        }

        // Send the notification (FR.3, FR.4, FR.5)
        await this.notificationService.notify(event.accountId, accountHolderEmail);
      } catch (error) {
        console.error(
          "[LLMTaskTool] Error in HenTaskCompletionNotifier during task completion:",
          error
        );
      }
    });

    console.log("[LLMTaskTool] Event handlers registered successfully.");
  }

  /**
   * Get the notification service for testing or custom uses.
   */
  public getNotificationService(): HenTaskCompletionNotifier | undefined {
    return this.notificationService;
  }
}