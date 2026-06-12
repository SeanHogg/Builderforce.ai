import { type LLMTask } from "@builderforce/llm-agent";
import { type TaskCompletionEvent, type TaskUpdateEvent } from "../src/types/task"; // Assuming these types exist
import { HenTaskCompletionNotifier, HenTaskCompletionNotifierSchema } from "./hen-task-completion-notifier";
import { Logger } from "../src/utils/logging"; // Assuming Logger utility exists
import { type NotificationService } from "../src/services/notificationService"; // Assuming NotificationService exists
import { type AccountService } from "../src/services/accountService"; // Assuming AccountService exists

const logger = new Logger("LLMTaskTool");

// Define the configuration schema for the Hen Task Completion Notifier tool
export const HenTaskCompletionNotifierToolConfigSchema = HenTaskCompletionNotifierSchema.extend({
	// Potentially add tool-specific configurations here if needed
});

type LLMTaskExtensionConfig = z.infer<typeof HenTaskCompletionNotifierToolConfigSchema>;

/**
 * LLM Task Tool Extension
 * Provides task-related functionalities like completion notification.
 */
export class LLMTaskTool {
	private config: LLMTaskExtensionConfig;
	private notificationService: NotificationService;
	private accountService: AccountService;
	private henTaskCompletionNotifier?: HenTaskCompletionNotifier;

	constructor(config: LLMTaskExtensionConfig, notificationService: NotificationService, accountService: AccountService) {
		this.config = HenTaskCompletionNotifierToolConfigSchema.parse(config);
		this.notificationService = notificationService;
		this.accountService = accountService;
		this.initializeNotifier();
	}

	private initializeNotifier(): void {
		this.henTaskCompletionNotifier = new HenTaskCompletionNotifier(
			this.config,
			this.notificationService,
			this.accountService
		);
		logger.info("HenTaskCompletionNotifier initialized.");
	}

	/**
	 * Registers the tool's event handlers.
	 * @param {LLMTask} llmTask - The LLMTask instance to register handlers with.
	 */
	public register(llmTask: LLMTask): void {
		logger.info("Registering event handlers for LLMTaskTool...");

		// Register handler for task completion events
		llmTask.onTaskComplete(async (event: TaskCompletionEvent) => {
			logger.debug("LLMTaskTool received TaskCompletionEvent:", event);
			if (this.henTaskCompletionNotifier) {
				try {
					await this.henTaskCompletionNotifier.handleTaskCompletion(event);
				} catch (err) {
					logger.error("Error in HenTaskCompletionNotifier during task completion:", err);
				}
			} else {
				logger.warn("HenTaskCompletionNotifier not initialized. Cannot handle task completion.");
			}
		});

		// Optional: Register handler for task update events if needed for more complex logic
		// llmTask.onTaskUpdate(async (event: TaskUpdateEvent) => {
		//     logger.debug("LLMTaskTool received TaskUpdateEvent:", event);
		//     // Add logic here if task updates need to trigger notifications or other actions
		// });

		logger.info("Event handlers registered successfully.");
	}
}

// Export the configuration schema for potential external use or validation
export { HenTaskCompletionNotifierToolConfigSchema };
