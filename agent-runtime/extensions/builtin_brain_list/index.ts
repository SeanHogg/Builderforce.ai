import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";
import { emptyPluginConfigSchema } from "@seanhogg/builderforce-agents/plugin-sdk";
import type {
  ChatMetadata,
  BrainListResponse,
  BrainListError,
  ErrorCode,
} from "./types";

interface BrainListConfig {
  /** Maximum number of chats to return (soft limit, not enforced) */
  maxChats?: number;
  /** Whether to include archived chats in results */
  includeArchived?: boolean;
}

const builtinBrainListPlugin = {
  id: "builtin_brain_list",
  name: "Brain List (Project Chats)",
  description: "List all chat sessions for a given project ID",
  kind: "memory",
  configSchema: emptyPluginConfigSchema(),
  register(api: BuilderForceAgentsPluginApi) {
    // Register the builtin_brain_list tool
    api.registerTool(
      (ctx) => {
        const tool = api.runtime.tools.createTool({
          name: "builtin_brain_list",
          description: "List all chats for a specific project. Returns a list of chat sessions with metadata including chatId, title, timestamps, participant count, message count, archived status, and last message preview.",
          parameters: {
            type: "object",
            properties: {
              projectId: {
                type: "number",
                description: "The project ID to query chats for",
              },
            },
            required: ["projectId"],
            additionalProperties: false,
          },
        });

        if (!tool) {
          return null;
        }

        // Execute the tool
        tool.execute = async (
          params: { projectId: number },
          _options: unknown,
          _callback?: unknown
        ): Promise<BrainListResponse> => {
          const projectId = params.projectId;

          // Validate projectId
          if (
            typeof projectId !== "number" ||
            !Number.isInteger(projectId) ||
            projectId <= 0
          ) {
            throw new BrainListError(
              "Invalid projectId. Must be a positive integer.",
              ErrorCode.INVALID_PROJECT_ID
            );
          }

          try {
            // Get project chats from the platform
            const chats = await getProjectChats(api, projectId);

            // Sort by updatedAt descending (newest first)
            chats.sort((a, b) => {
              const dateA = new Date(a.updatedAt).getTime();
              const dateB = new Date(b.updatedAt).getTime();
              return dateB - dateA;
            });

            // Filter out archived chats if requested
            if (
              (ctx.config as BrainListConfig).includeArchived !== true
            ) {
              const nonArchived = chats.filter(
                (chat) => !chat.isArchived
              );
              if (nonArchived.length !== chats.length) {
                // Log a warning that some chats were excluded
                console.warn(
                  `[builtin_brain_list] ${chats.length - nonArchived.length} archived chats were filtered out for projectId ${projectId}`
                );
              }
              return { chats: nonArchived };
            }

            return { chats };
          } catch (error) {
            if (error instanceof BrainListError) {
              throw error;
            }
            // Log unexpected errors
            console.error(
              `[builtin_brain_list] Error listing chats for projectId ${projectId}:`,
              error
            );
            throw new BrainListError(
              "An unexpected error occurred. Please try again later.",
              ErrorCode.INTERNAL_ERROR
            );
          }
        };

        return [tool];
      },
      { names: ["builtin_brain_list"] },
    );

    // Register CLI command for debugging/simulation
    api.registerCli(
      ({ program }) => {
        program
          .command("brain-list")
          .description("List project chats (simulated for debugging)")
          .option("-p, --projectId <number>", "Project ID")
          .option(
            "-a, --include-archived",
            "Include archived chats in results"
          )
          .option("-m, --max-chats <number>", "Maximum number of chats to show")
          .action(async (options) => {
            if (!options.projectId || isNaN(options.projectId)) {
              console.log(
                "Error: --projectId option is required. Example: --projectId 11"
              );
              process.exit(1);
            }

            const config: BrainListConfig = {};
            if (options.includeArchived) {
              config.includeArchived = true;
            }
            if (options.maxChats) {
              config.maxChats = parseInt(options.maxChats, 10);
            }

            const clientId = api.auth.getClientId();
            const accessToken = await api.auth.getAccessToken({ clientId });
            const authHeaders = api.auth.getAuthHeaders(accessToken);

            try {
              const response = await fetch(
                `${api.serverBaseURL}/api/builtin_brain_list`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...authHeaders,
                  },
                  body: JSON.stringify({
                    projectId: options.projectId,
                    ...config,
                  }),
                }
              );

              const data = await response.json();

              if (!response.ok) {
                console.error("Error:", data.error);
                process.exit(1);
              }

              console.log("Found", data.chats.length, "chats:");
              data.chats.forEach((chat: ChatMetadata, i: number) => {
                console.log(`\n[${i + 1}] ${chat.title}`);
                console.log(`   ID: ${chat.chatId}`);
                console.log(
                  `   Created: ${new Date(chat.createdAt).toLocaleString()}`
                );
                console.log(
                  `   Updated: ${new Date(chat.updatedAt).toLocaleString()}`
                );
                console.log(
                  `   Messages: ${chat.messageCount}, Participants: ${chat.participantCount}`
                );
                console.log(`   Archived: ${chat.isArchived}`);
                console.log(`   Last: "${chat.lastMessagePreview}"`);
                if (chat.tags && chat.tags.length > 0) {
                  console.log(`   Tags: ${chat.tags.join(", ")}`);
                }
              });
            } catch (error) {
              console.error("Failed to fetch chats:", error);
              process.exit(1);
            }
          });
      },
      { commands: ["builtin"] },
    );
  },
};

/**
 * Mock implementation for development/testing.
 * In production, this would integrate with the actual chat storage.
 */
async function getProjectChats(
  api: BuilderForceAgentsPluginApi,
  projectId: number
): Promise<ChatMetadata[]> {
  // This is a placeholder/mock implementation.
  // The actual implementation should query the platform's chat storage.

  // For now, return an empty array as a baseline
  // TODO: Integrate with actual chat storage system
  console.log(
    `[builtin_brain_list] Project ${projectId} has no chats (mock mode)`
  );

  // Simulated data for testing (matching the PRD's example of 13 chats)
  // This would be replaced with actual storage queries in production
  const simulatedChats: ChatMetadata[] = Array.from({ length: 13 }, (_, i) => ({
    chatId: `chat-${projectId}-${i + 1}`,
    title: `Team Chat ${i + 1}`,
    createdAt: new Date(
      Date.now() - (i + 1) * 86400000
    ).toISOString(), // 1 day apart
    updatedAt: new Date(
      Date.now() - i * 7200000
    ).toISOString(), // 2 hours apart
    participantCount: Math.floor(Math.random() * 5) + 1,
    messageCount: Math.floor(Math.random() * 50) + 5,
    isArchived: i % 3 === 0, // 1/3 archived
    lastMessagePreview:
      i === 0
        ? "Let's discuss the Q4 strategy"
        : `Message ${i + 1} about project updates`,
    tags: i % 5 === 0 ? ["urgent"] : [],
  }));

  return simulatedChats;
}

export default builtinBrainListPlugin;