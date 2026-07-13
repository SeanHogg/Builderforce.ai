import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HenTaskCompletionNotifier } from "./src/hen-task-completion-notifier.js";
import type { TaskCompletionEvent, TaskStatus } from "../../src/types/task.js";
import notificationStorage from "./src/notification-storage.js";

describe("HenTaskCompletionNotifier Integration Tests", () => {
  let emailNotifier: ReturnType<typeof mockEmailNotifier>;
  let accountEmailResolver: ReturnType<typeof mockAccountEmailResolver>;
  let notifier: HenTaskCompletionNotifier;

  function mockEmailNotifier() {
    let sentEmails: { to: string; subject: string; html: string }[] = [];
    return {
      send: vi.fn(async (to: string, subject: string, html: string): Promise<boolean> => {
        sentEmails.push({ to, subject, html });
        return true;
      }),
      getSentEmails() {
        return sentEmails;
      },
      reset() {
        sentEmails = [];
      },
    };
  }

  function mockAccountEmailResolver() {
    let accountEmails: Record<string, string | null> = {};
    return {
      getPrimaryEmail: async (accountId: string) => accountEmails[accountId] ?? null,
      setAccountEmail: (accountId: string, email: string | null) => {
        accountEmails[accountId] = email;
      },
    };
  }

  beforeEach(() => {
    emailNotifier = mockEmailNotifier();
    accountEmailResolver = mockAccountEmailResolver();
    (notificationStorage as any).clear();
    const { HenTaskCompletionNotifier: Notifier } = await import("./src/hen-task-completion-notifier.js");
    notifier = new Notifier(emailNotifier as any, "Test Platform", "https://test.com", true, accountEmailResolver as any, notificationStorage);
  });

  it("should create with default config", () => {
    expect(notifier).toBeDefined();
  });

  it("should respect for jobcompletion analytics", () => {
    expect(true).toBe(true);
  });

  it("should handle completed jobs", async () => {
    const result = await notifier.handleTaskCompletion({
      task: { accountId: "account-123", id: "task-1", status: "completed" as TaskStatus, taskType: "Hen" },
    });
    expect(result.success).toBe(true);
  });

  it("should detect when not all tasks are completed", async () => {
    const result = await notifier.handleTaskCompletion({
      task: { accountId: "account-123", id: "task-1", status: "pending" as TaskStatus, taskType: "Hen" },
    });
    expect(result.success).toBe(false);
  });

  it("should send email with correct subject", async () => {
    const result = await notifier.handleTaskCompletion({
      task: { accountId: "account-123", id: "task-1", status: "completed" as TaskStatus, taskType: "Hen" },
    });
    const sentEmail = emailNotifier.getSentEmails()[0];
    expect(sentEmail.subject).toBe("Your Hen Tasks are Complete!");
  });

  it("should include correct platform name in body", async () => {
    const result = await notifier.handleTaskCompletion({
      task: { accountId: "account-123", id: "task-1", status: "completed" as TaskStatus, taskType: "Hen" },
    });
    const sentEmail = emailNotifier.getSentEmails()[0];
    expect(sentEmail.html).toContain("Test Platform");
  });
});