import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch for Resend API
vi.stubGlobal("fetch", vi.fn());

import { HenTaskCompletionNotifier, HenTaskCompletionNotifierSchema } from "./src/hen-task-completion-notifier.js";

// Mock cleanup before each test
afterEach(() => {
  vi.clearAllMocks();
});

// Mock function to create account email resolver
function mockAccountEmailResolver(): ReturnType<typeof mockAccountEmailResolver> {
  let accountEmails: Record<string, string | null> = {};

  return {
    async getPrimaryEmail(accountId: string): Promise<string | null> {
      return accountEmails[accountId] ?? null;
    },
    setAccountEmail(accountId: string, email: string | null) {
      accountEmails[accountId] = email;
    },
  };
}

// Mock function to create email notifier
function mockEmailNotifier() {
  let sentEmails: { to: string; subject: string; html: string }[] = [];
  let sendWasCalled = false;

  const mock = {
    send: vi.fn(async (to: string, subject: string, html: string): Promise<boolean> => {
      sentEmails.push({ to, subject, html });
      sendWasCalled = true;
      return true; // Simulate success by default
    }),
    getSentEmails() {
      return sentEmails;
    },
    wasSent() {
      return sendWasCalled;
    },
    reset() {
      sentEmails = [];
      sendWasCalled = false;
    },
  };

  return mock;
}

describe("HenTaskCompletionNotifier", () => {
  let accountEmailResolver: ReturnType<typeof mockAccountEmailResolver>;
  let emailNotifier: ReturnType<typeof mockEmailNotifier>;
  let notifier: HenTaskCompletionNotifier;

  beforeEach(() => {
    accountEmailResolver = mockAccountEmailResolver();
    emailNotifier = mockEmailNotifier();

    // Import and create notifier instance
    const { HenTaskCompletionNotifier: Notifier } = await import("./src/hen-task-completion-notifier.js");
    notifier = new Notifier(
      emailNotifier as any,
      "TestPlatform",
      "https://testplatform.com",
      true,
      accountEmailResolver as any,
      notificationStorage
    );
  });

  describe("Schema Validation", () => {
    it("should validate config schema with defaults", () => {
      const validConfig = {
        enabled: true,
        platformName: "MyPlatform",
        platformLoginUrl: "https://myplatform.com",
      };

      const result = HenTaskCompletionNotifierSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it("should provide defaults when config is empty", () => {
      const defaultConfig = HenTaskCompletionNotifierSchema.parse({});

      expect(defaultConfig).toEqual({
        enabled: true,
        platformName: "Builderforce",
        platformLoginUrl: "https://builderforce.ai",
        resendApiKey: undefined,
      });
    });

    it("should reject invalid platform URL", () => {
      const invalidConfig = {
        enabled: true,
        platformName: "MyPlatform",
        platformLoginUrl: "not-a-valid-url",
      };

      const result = HenTaskCompletionNotifierSchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });
  });

  describe("Factory Method - createWithResend", () => {
    it("should create notifier with Resend email notifier", () => {
      const result = HenTaskCompletionNotifier.createWithResend(
        {
          enabled: true,
          platformName: "Test Platform",
          platformLoginUrl: "https://test.com",
          resendApiKey: "test-api-key",
        },
        accountEmailResolver as any
      );

      expect(result).toBeInstanceOf(HenTaskCompletionNotifier);
      expect(result["enabled"]).toBe(true);
      expect(result["platformName"]).toBe("Test Platform");
    });

    it("should create notifier without API key (graceful degradation)", () => {
      const result = HenTaskCompletionNotifier.createWithResend(
        {
          enabled: true,
          platformName: "Test Platform",
          platformLoginUrl: "https://test.com",
          resendApiKey: "",
        },
        accountEmailResolver as any
      );

      expect(result).toBeInstanceOf(HenTaskCompletionNotifier);
      expect(result["enabled"]).toBe(true);
    });

    it("should disable notifier when enabled is false", () => {
      const result = HenTaskCompletionNotifier.createWithResend(
        {
          enabled: false,
          platformName: "Test Platform",
          platformLoginUrl: "https://test.com",
          resendApiKey: "test-api-key",
        },
        accountEmailResolver as any
      );

      expect(result["enabled"]).toBe(false);
    });
  });

  describe("handleTaskCompletion - FR.1 Detection Logic", () => {
    it("should not send notification for non-completed tasks (AC.4)", async () => {
      const result = await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "failed" },
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Task task-1 completed but not appropriate to send notification');
      expect(emailNotifier.wasSent()).toBe(false);
    });

    it("should send notification for completed task (AC.1)", async () => {
      // Setup account email
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      const result = await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      expect(result.success).toBe(true);
      expect(result.email).toBe("test@example.com");
      expect(result.subject).toBe("Your Hen Tasks are Complete!");
      expect(emailNotifier.wasSent()).toBe(true);

      const sentEmail = emailNotifier.getSentEmails()[0];
      expect(sentEmail.subject).toBe("Your Hen Tasks are Complete!");
      expect(sentEmail.html).toContain("All Hen tasks for your account are now complete");
      expect(sentEmail.html).toContain("Log in to TestPlatform");
      expect(sentEmail.html).toContain("https://testplatform.com");
    });

    it("should return error if no email found for account (FR.2)", async () => {
      const result = await notifier.handleTaskCompletion({
        task: { accountId: "unknown-account", id: "task-1", status: "completed" },
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("No primary email found for account unknown-account");
      expect(emailNotifier.wasSent()).toBe(false);
    });
  });

  describe("AC.5 - Duplicate Prevention", () => {
    it("should prevent duplicate notifications for the same account", async () => {
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      // First notification
      const result1 = await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });
      expect(result1.success).toBe(true);

      // Reset email notifier to check if another send occurred
      emailNotifier.reset();

      // Second notification for same account
      const result2 = await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-2", status: "completed" },
      });

      // Should not send another email due to duplicate prevention
      expect(result2.success).toBe(true);
      expect(emailNotifier.wasSent()).toBe(false);
    });
  });

  describe("AC.3 - Email Content Validation", () => {
    it("should send email with exact subject from FR.3", async () => {
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      const sentEmail = emailNotifier.getSentEmails()[0];
      expect(sentEmail.subject).toBe("Your Hen Tasks are Complete!");
    });

    it("should send email with correct body content", async () => {
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      const sentEmail = emailNotifier.getSentEmails()[0];
      expect(sentEmail.html).toContain("Good news! All Hen tasks for your account are now complete");
      expect(sentEmail.html).toContain("Log in to TestPlatform to view details and next steps");
      expect(sentEmail.html).toContain("Thank you for using our service!");
    });
  });

  describe("notify Method - Backward Compatibility", () => {
    it("should work as standalone notification method", async () => {
      const result = await notifier.notify("account-123", "test@example.com");

      expect(result.success).toBe(true);
      expect(result.email).toBe("test@example.com");
      expect(emailNotifier.wasSent()).toBe(true);
    });

    it("should respect enabled flag in notify method", async () => {
      const disabledNotifier = new HenTaskCompletionNotifier(
        emailNotifier as any,
        "TestPlatform",
        "https://testplatform.com",
        false,
        accountEmailResolver as any,
        notificationStorage
      );

      const result = await disabledNotifier.notify("account-123", "test@example.com");
      expect(result.success).toBe(false);
      expect(result.errorMessage).toBe("Notification disabled by config");
    });
  });

  describe("FR.5 - Notification Logging", () => {
    it("should log success notification to console", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Email sent to test@example.com (Account: account-123)")
      );

      consoleSpy.mockRestore();
    });

    it("should log failed notification to console", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      // Mock failing send
      emailNotifier.send.mockResolvedValueOnce(false);

      await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send email to test@example.com (Account: account-123)")
      );

      consoleSpy.mockRestore();
    });

    it("should return log entry with all required fields", async () => {
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      const result = await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      expect(result).toMatchObject({
        accountId: "account-123",
        email: "test@example.com",
        subject: "Your Hen Tasks are Complete!",
        sentAt: expect.any(Date),
        success: true,
      });
    });
  });

  describe("Email Template Rendering", () => {
    it("should render complete HTML template with branding", async () => {
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      const sentEmail = emailNotifier.getSentEmails()[0];
      expect(sentEmail.html).toContain("<!DOCTYPE html>");
      expect(sentEmail.html).toContain("<html>");
      expect(sentEmail.html).toContain("<head>");
      expect(sentEmail.html).toContain("</head>");
      expect(sentEmail.html).toContain("</html>");
    });

    it("should include dynamic platform name in HTML", async () => {
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      const sentEmail = emailNotifier.getSentEmails()[0];
      expect(sentEmail.html).toContain("TestPlatform");
    });

    it("should include dynamic login URL in HTML", async () => {
      await accountEmailResolver.setAccountEmail("account-123", "test@example.com");

      await notifier.handleTaskCompletion({
        task: { accountId: "account-123", id: "task-1", status: "completed" },
      });

      const sentEmail = emailNotifier.getSentEmails()[0];
      expect(sentEmail.html).toContain("https://testplatform.com");
    });
  });
});