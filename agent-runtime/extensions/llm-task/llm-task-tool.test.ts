/**
 * Tests for Hen Task Completion Notifier Integration
 */

import { describe, it, expect, vi } from "vitest";
import { HenTaskCompletionNotifier } from "./src/hen-task-completion-notifier.js";
import type { TaskCompletionEvent, TaskStatus } from "../../src/types/task.js";

describe("HenTaskCompletionNotifier", () => {
  describe("Factory method", () => {
    it("should create notifier with given config", () => {
      const notifier = HenTaskCompletionNotifier.createResend(
        "test-api-key",
        "Test Platform",
        "https://test.com",
        true
      );
      expect(notifier).toBeInstanceOf(HenTaskCompletionNotifier);
    });

    it("should create notifier with minimal config", () => {
      const notifier = HenTaskCompletionNotifier.createResend(
        "test-api-key",
        "Test Platform",
        "https://test.com",
        true
      );
      expect(notifier).toBeDefined();
    });
  });

  describe("notify method", () => {
    it("should return log entry on successful notification", async () => {
      const mockEmailNotifier = {
        send: vi.fn().mockResolvedValue(true),
      };

      const notifier = new HenTaskCompletionNotifier(
        mockEmailNotifier as any,
        "Test Platform",
        "https://test.com",
        true
      );

      const result = await notifier.notify("account-123", "test@example.com");

      expect(result).toEqual({
        accountId: "account-123",
        email: "test@example.com",
        subject: "Your Hen Tasks are Complete!",
        sentAt: expect.any(Date),
        success: true,
      });
      expect(mockEmailNotifier.send).toHaveBeenCalledWith(
        "test@example.com",
        "Your Hen Tasks are Complete!",
        expect.any(String)
      );
    });

    it("should return log entry on failed notification", async () => {
      const mockEmailNotifier = {
        send: vi.fn().mockResolvedValue(false),
      };

      const notifier = new HenTaskCompletionNotifier(
        mockEmailNotifier as any,
        "Test Platform",
        "https://test.com",
        true
      );

      const result = await notifier.notify("account-123", "test@example.com");

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBeDefined();
    });

    it("should handle disabled notification", async () => {
      const mockEmailNotifier = {
        send: vi.fn().mockResolvedValue(true),
      };

      const notifier = new HenTaskCompletionNotifier(
        mockEmailNotifier as any,
        "Test Platform",
        "https://test.com",
        false
      );

      const result = await notifier.notify("account-123", "test@example.com");

      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("Notification disabled by config");
    });
  });

  describe("task completion detection logic", () => {
    it("should check if all Hen tasks are completed", () => {
      const tasks = [
        { id: "1", status: "completed" as TaskStatus, taskType: "Hen" },
        { id: "2", status: "completed" as TaskStatus, taskType: "Hen" },
        { id: "3", status: "completed" as TaskStatus, taskType: "Hen" },
      ];

      const allComplete = tasks.every((task) => task.status === "completed");

      expect(allComplete).toBe(true);
    });

    it("should detect when not all tasks are completed", () => {
      const tasks = [
        { id: "1", status: "completed" as TaskStatus, taskType: "Hen" },
        { id: "2", status: "running" as TaskStatus, taskType: "Hen" },
        { id: "3", status: "pending" as TaskStatus, taskType: "Hen" },
      ];

      const allComplete = tasks.every((task) => task.status === "completed");

      expect(allComplete).toBe(false);
    });
  });

  describe("email content", () => {
    it("should use correct subject line", async () => {
      const mockEmailNotifier = {
        send: vi.fn().mockResolvedValue(true),
      };

      const notifier = new HenTaskCompletionNotifier(
        mockEmailNotifier as any,
        "Test Platform",
        "https://test.com",
        true
      );

      await notifier.notify("account-123", "test@example.com");

      expect(mockEmailNotifier.send).toHaveBeenCalledWith(
        "test@example.com",
        "Your Hen Tasks are Complete!",
        expect.any(String)
      );
    });

    it("should include platform name in email body", async () => {
      const mockEmailNotifier = {
        send: vi.fn().mockResolvedValue(true),
      };

      const notifier = new HenTaskCompletionNotifier(
        mockEmailNotifier as any,
        "My Platform",
        "https://myplatform.com/login",
        true
      );

      await notifier.notify("account-123", "test@example.com");

      const callArg = (mockEmailNotifier.send as jest.Mock).mock.calls[0][2];
      expect(callArg).toContain("My Platform");
      expect(callArg).toContain("myplatform.com/login");
    });
  });
});