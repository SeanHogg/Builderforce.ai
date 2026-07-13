import { type LLMTask } from "@builderforce/llm-agent";
import { type TaskCompletionEvent, type TaskUpdateEvent } from "../src/types/task.js";
import type { EmailNotifier, AccountEmailResolver } from "../../src/transport/notification-domain-ports.js";
import { HenTaskCompletionNotifier, HenTaskCompletionNotifierSchema } from "./hen-task-completion-notifier.js";
import { getLogger } from "../../src/logging.js";
import notificationStorage from "./notification-storage.js";

const logger = getLogger();

type LLMTaskExtensionConfig = z.infer<typeof HenTaskCompletionNotifierSchema>;

/**
 * LLM Task Tool Extension
 * Provides task-related functionalities like completion notification.
 */
export class LLMTaskTool {
  private config: LLMTaskExtensionConfig;
  private accountEmailResolver: any;
  private henTaskCompletionNotifier?: HenTaskCompletionNotifier;

  constructor(config: LLMTaskExtensionConfig, accountEmailResolver?: any) {
    this.config = config;
    this.accountEmailResolver = accountEmailResolver || {
      getPrimaryEmail: async (accountId: string): Promise<string | null> => {
        logger.debug(`[LLMTaskTool] No accountEmailResolver provided, using mock`);
        return `account-${accountId}@example.com`;
      },
    };
    this.initializeNotifier();
  }

  private initializeNotifier(): void {
    this.henTaskCompletionNotifier = HenTaskCompletionNotifier.createWithResend(this.config, this.accountEmailResolver);
    logger.info("[LLMTaskTool] HenTaskCompletionNotifier initialized.");
  }

  /**
   * Registers the tool's event handlers.
   * @param {LLMTask} llmTask - The LLMTask instance to register handlers with.
   */
  public register(llmTask: LLMTask): void {
    logger.info("[LLMTaskTool] Registering event handlers...");

    // Register handler for task completion events
    llmTask.onTaskComplete(async (event: TaskCompletionEvent) => {
      logger.debug("[LLMTaskTool] Received TaskCompletionEvent:", event);
      if (this.henTaskCompletionNotifier) {
        try {
          await this.henTaskCompletionNotifier.handleTaskCompletion({
            task: event.task,
          });
        } catch (err) {
          logger.error("[LLMTaskTool] Error in HenTaskCompletionNotifier:", err);
        }
      } else {
        logger.warn("[LLMTaskTool] HenTaskCompletionNotifier not initialized.");
      }
    });

    // Register handler for task update events (for monitoring)
    llmTask.onTaskUpdate(async (event: TaskUpdateEvent) => {
      logger.debug("[LLMTaskTool] Received TaskUpdateEvent:", event);
    });

    logger.info("[LLMTaskTool] Event handlers registered successfully.");
  }
}

// Export the configuration schema for potential external use or validation
export { HenTaskCompletionNotifierSchema };

// Alias for the configuration schema type
export type LLMTaskExtensionConfig = z.infer<typeof HenTaskCompletionNotifierSchema>;