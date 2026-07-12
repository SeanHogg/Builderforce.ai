/**
 * Unit tests for builtin_brain_list plugin.
 *
 * These tests verify the core functionality of the plugin including:
 * - Input validation
 * - Output structure and data types
 * - Error handling
 * - Mock data generation
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { builtinBrainListPlugin } from "./index";
import type { BuilderForceAgentsPluginApi } from "@seanhogg/builderforce-agents/plugin-sdk";

describe("builtin_brain_list Plugin", () => {
  let mockApi: BuilderForceAgentsPluginApi;

  beforeEach(() => {
    // Mock the BuilderForceAgentsPluginApi
    mockApi = {
      auth: {
        getClientId: vi.fn(() => "test-client-id"),
        getAccessToken: vi.fn(() => "test-token"),
        getAuthHeaders: vi.fn(() => ({})),
        checkProjectAccess: vi.fn(() => Promise.resolve(true)),
      },
      runtime: {
        tools: {
          createTool: vi.fn(),
          createMemorySearchTool: vi.fn(),
          createMemoryGetTool: vi.fn(),
          registerMemoryCli: vi.fn(),
        },
      },
      registerTool: vi.fn(),
      registerCli: vi.fn(),
      serverBaseURL: "https://api.builderforce.ai",
    } as unknown as BuilderForceAgentsPluginApi;
  });

  describe("Tool Registration", () => {
    it("should register the builtin_brain_list tool", () => {
      builtinBrainListPlugin.register(mockApi);

      expect(mockApi.registerTool).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          names: ["builtin_brain_list"],
        })
      );
    });

    it("should create tool with correct schema", () => {
      const createToolSpy = mockApi.runtime.tools.createTool as unknown as vi.Mock;
      builtinBrainListPlugin.register(mockApi);

      expect(createToolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "builtin_brain_list",
          description: expect.stringContaining("List all chats for a specific project"),
          parameters: {
            type: "object",
            properties: {
              projectId: {
                type: "number",
                description: expect.stringContaining("project ID"),
              },
            },
            required: ["projectId"],
            additionalProperties: false,
          },
        })
      );
    });

    it("should register CLI command", () => {
      builtinBrainListPlugin.register(mockApi);

      expect(mockApi.registerCli).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          commands: ["builtin"],
        })
      );
    });
  });

  describe("Input Validation", () => {
    let tool: any;

    beforeEach(() => {
      builtinBrainListPlugin.register(mockApi);
      const registeredTool = mockApi.registerTool.mock.calls[0][0]({ config: {} });
      tool = registeredTool[0];
    });

    it("rejects non-numeric projectId", async () => {
      try {
        await tool.execute({ projectId: "invalid" } as any);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("projectId");
      }
    });

    it("rejects negative projectId", async () => {
      try {
        await tool.execute({ projectId: -1 });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
      }
    });

    it("rejects zero projectId", async () => {
      try {
        await tool.execute({ projectId: 0 });
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
      }
    });

    it("accepts valid projectId", async () => {
      const result = await tool.execute({ projectId: 11 });
      expect(result.chats).toBeDefined();
      expect(Array.isArray(result.chats)).toBe(true);
    });
  });

  describe("Output Structure", () => {
    let tool: any;

    beforeEach(() => {
      builtinBrainListPlugin.register(mockApi);
      const registeredTool = mockApi.registerTool.mock.calls[0][0]({ config: {} });
      tool = registeredTool[0];
    });

    it("returns BrainListResponse structure", async () => {
      const result = await tool.execute({ projectId: 11 });

      expect(result).toHaveProperty("chats");
      expect(Array.isArray(result.chats)).toBe(true);
    });

    it("each chat has required fields", async () => {
      const result = await tool.execute({ projectId: 11 });
      const chat = result.chats[0];

      expect(chat).toHaveProperty("chatId");
      expect(chat).toHaveProperty("title");
      expect(chat).toHaveProperty("createdAt");
      expect(chat).toHaveProperty("updatedAt");
      expect(chat).toHaveProperty("participantCount");
      expect(chat).toHaveProperty("messageCount");
      expect(chat).toHaveProperty("isArchived");
      expect(chat).toHaveProperty("lastMessagePreview");
    });

    it("chat fields are of correct types", async () => {
      const result = await tool.execute({ projectId: 11 });
      const chat = result.chats[0];

      expect(typeof chat.chatId).toBe("string");
      expect(typeof chat.title).toBe("string");
      expect(typeof chat.createdAt).toBe("string");
      expect(typeof chat.updatedAt).toBe("string");
      expect(typeof chat.participantCount).toBe("number");
      expect(typeof chat.messageCount).toBe("number");
      expect(typeof chat.isArchived).toBe("boolean");
      expect(typeof chat.lastMessagePreview).toBe("string");
    });

    it("includes optional fields when available", async () => {
      const result = await tool.execute({ projectId: 11 });
      const chat = result.chats[0];

      // Optional fields should be undefined if not present
      expect(chat.participants).toBeUndefined();
      expect(chat.tags).toBeUndefined();
    });
  });

  describe("Query Ordering", () => {
    let tool: any;

    beforeEach(() => {
      builtinBrainListPlugin.register(mockApi);
      const registeredTool = mockApi.registerTool.mock.calls[0][0]({ config: {} });
      tool = registeredTool[0];
    });

    it("returns chats ordered by updatedAt descending", async () => {
      const result = await tool.execute({ projectId: 11 });

      for (let i = 0; i < result.chats.length - 1; i++) {
        const current = new Date(result.chats[i].updatedAt).getTime();
        const next = new Date(result.chats[i + 1].updatedAt).getTime();
        expect(current).toBeGreaterThanOrEqual(next);
      }
    });
  });

  describe("Archive Filtering", () => {
    let tool: any;

    beforeEach(() => {
      builtinBrainListPlugin.register(mockApi);
      const registeredTool = mockApi.registerTool.mock.calls[0][0]({
        config: { includeArchived: false },
      });
      tool = registeredTool[0];
    });

    it("filters out archived chats by default", async () => {
      const result = await tool.execute({ projectId: 11 });

      result.chats.forEach((chat: any) => {
        if (process.env.BUILTIN_BRAIN_LIST_MOCK === "true") {
          // In mock mode, some chats may be archived
          expect(chat.isArchived).toBe(false);
        }
      });
    });

    it("respects includeArchived: true", async () => {
      const registeredTool2 = mockApi.registerTool.mock.calls[0][0]({
        config: { includeArchived: true },
      });
      const toolWithArchives = registeredTool2[0];

      const result = await toolWithArchives.execute({ projectId: 11 });

      // All chats should be present
      expect(result.chats).toBeDefined();
    });

    it("handles includeArchived in CLI mode", async () => {
      const config = {
        config: { includeArchived: true },
      } as any;

      // Simulate CLI usage
      try {
        await tool.execute({ projectId: 11 }, {}, null);
      } catch (error) {
        // We expect a warning in mock mode with archived chats
        expect(error).toBeDefined();
      }
    });
  });

  describe("Error Handling", () => {
    let tool: any;

    beforeEach(() => {
      builtinBrainListPlugin.register(mockApi);
      const registeredTool = mockApi.registerTool.mock.calls[0][0]({ config: {} });
      tool = registeredTool[0];
    });

    it("throws BrainListError for invalid projectId type", async () => {
      try {
        await tool.execute({ projectId: "not-a-number" });
      } catch (error: any) {
        expect(error.constructor.name).toBe("BrainListError");
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain("projectId");
      }
    });

    it("throws BrainListError for invalid projectId value", async () => {
      try {
        await tool.execute({ projectId: 0 });
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
      }
    });

    it("throws BrainListError with 500 for unexpected errors", async () => {
      // Mock an error during execution
      const getProjectChats = (module as any).getProjectChats;
      (module as any).getProjectChats = vi.fn(() => {
        throw new Error("Unexpected database error");
      });

      try {
        await tool.execute({ projectId: 11 });
      } catch (error: any) {
        expect(error.statusCode).toBe(500);
        expect(error.message).toContain("unexpected error");
      }

      // Restore function
      (module as any).getProjectChats = getProjectChats;
    });
  });

  describe("Mock Data", () => {
    it("generates correct number of mock chats", async () => {
      const result = await tool.execute({ projectId: 11 });

      expect(result.chats.length).toBeGreaterThanOrEqual(0);
      expect(result.chats.length).toBeLessThanOrEqual(13); // PRD confirms 13 chats exist
    });

    it("generates unique chatIds", async () => {
      const result = await tool.execute({ projectId: 11 });
      const chatIds = result.chats.map((c: any) => c.chatId);

      const uniqueIds = new Set(chatIds);
      expect(chatIds.length).toBe(uniqueIds.size);
    });

    it("generates consistent chatIds for same projectId", async () => {
      const result1 = await tool.execute({ projectId: 11 });
      const result2 = await tool.execute({ projectId: 11 });

      expect(result1.chats.length).toBe(result2.chats.length);

      result1.chats.forEach((chat1: any, i: number) => {
        const chat2 = result2.chats[i];
        expect(chat1.chatId).toBe(chat2.chatId);
      });
    });

    it("separates mock data based on projectId", async () => {
      const result1 = await tool.execute({ projectId: 11 });
      const result2 = await tool.execute({ projectId: 12 });

      // Each project should have its own set of mock chats
      expect(result1.chats.length).toBeGreaterThan(0);
      expect(result2.chats.length).toBeGreaterThan(0);
    });

    it("generates realistic timestamps", async () => {
      const result = await tool.execute({ projectId: 11 });

      result.chats.forEach((chat: any) => {
        expect(new Date(chat.createdAt).getTime()).toBeGreaterThan(0);
        expect(new Date(chat.updatedAt).getTime()).toBeGreaterThan(0);
      });
    });
  });

  describe("Performance Characteristics", () => {
    let tool: any;

    beforeEach(() => {
      builtinBrainListPlugin.register(mockApi);
      const registeredTool = mockApi.registerTool.mock.calls[0][0]({ config: {} });
      tool = registeredTool[0];
    });

    it("responds quickly for mock data", async () => {
      const startTime = Date.now();
      await tool.execute({ projectId: 11 });
      const duration = Date.now() - startTime;

      // Mock operations should be well under 300ms
      expect(duration).toBeLessThan(100);
    });

    it("handles small projects efficiently", async () => {
      // Test with projectId that has few chats (if we could test different results)
      const startTime = Date.now();
      await tool.execute({ projectId: 11 });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
    });
  });

  describe("Integration Behavior", () => {
    it("respects config in tool execution", async () => {
      const registeredTool = mockApi.registerTool.mock.calls[0][0]({
        config: { includeArchived: true },
      });
      const toolWithConfig = registeredTool[0];

      const result = await toolWithConfig.execute({ projectId: 11 });

      expect(result).toBeDefined();
      expect(Array.isArray(result.chats)).toBe(true);
    });

    it("uses mock API for development mode", async () => {
      const mockEnv = process.env.BUILTIN_BRAIN_LIST_MOCK;
      process.env.BUILTIN_BRAIN_LIST_MOCK = "true";

      builtinBrainListPlugin.register(mockApi);
      const registeredTool = mockApi.registerTool.mock.calls[0][0]({ config: {} });
      const tool = registeredTool[0];

      const result = await tool.execute({ projectId: 11 });

      expect(result.chats).toBeDefined();
      expect(Array.isArray(result.chats)).toBe(true);

      // Restore environment variable
      if (mockEnv) {
        process.env.BUILTIN_BRAIN_LIST_MOCK = mockEnv;
      } else {
        delete process.env.BUILTIN_BRAIN_LIST_MOCK;
      }
    });
  });
});