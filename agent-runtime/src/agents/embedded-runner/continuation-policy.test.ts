import { describe, expect, it } from "vitest";
import { buildAutoContinuePrompt, shouldAutoContinueRun } from "./continuation-policy.js";

describe("shouldAutoContinueRun", () => {
  it("continues on deferral language during execution tasks", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Wire executeWorkflow into orchestrate tool and run tests",
      assistantTexts: ["Let me check git history first and then I will continue."],
      toolNames: ["read", "git_history"],
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("deferral_language");
  });

  it("stops when assistant asks user a direct question", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Implement the roadmap item",
      assistantTexts: ["Which option do you want me to take?"],
      toolNames: ["read"],
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("asked_user_question");
  });

  it("continues when only investigation tools were used and no completion signal", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Fix the orchestrator wiring bug",
      assistantTexts: ["I reviewed the files and found the issue."],
      toolNames: ["read", "find", "grep"],
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("investigation_only_tools");
  });

  it("does not continue when response appears complete", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Fix the orchestrator wiring bug",
      assistantTexts: ["Implemented and tests passed. All tasks complete."],
      toolNames: ["read", "apply_patch"],
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe("looks_complete");
  });

  it("does not continue for non-execution prompts", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "What is the difference between these two files?",
      assistantTexts: ["Here is the difference..."],
      toolNames: ["read"],
    });

    expect(decision.shouldContinue).toBe(false);
  });

  it("uses payload text when assistant texts are empty", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Wire executeWorkflow into orchestrate tool and run tests",
      assistantTexts: [],
      payloadTexts: ["Let me check the exact line numbers and understand what this refers to."],
      toolNames: ["read", "git_history"],
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("deferral_language");
  });

  it("continues execution task when no assistant text but investigation-only tools ran", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Implement phase -1.1 and run tests",
      assistantTexts: [],
      toolNames: ["read", "grep", "find"],
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("tool_activity_no_progress");
  });

  it("continues when tool activity produced no assistant text", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Fix orchestrate-tool and complete the implementation",
      assistantTexts: [],
      toolNames: ["read", "str_replace_editor"],
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("tool_activity_no_progress");
  });

  it("continues when tool error occurs without a user question", () => {
    const decision = shouldAutoContinueRun({
      userPrompt: "Implement the fix and run tests",
      assistantTexts: ["Applying the edit now."],
      toolNames: ["str_replace_editor"],
      hasToolError: true,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe("tool_error_retry");
  });
});

describe("buildAutoContinuePrompt", () => {
  it("includes original request and prior incomplete response", () => {
    const prompt = buildAutoContinuePrompt({
      originalPrompt: "Wire executeWorkflow into orchestrate tool and run tests.",
      lastAssistantText: "Let me check the exact line numbers and understand the gap.",
      reason: "deferral_language",
    });

    expect(prompt).toContain("Original user request:");
    expect(prompt).toContain("Wire executeWorkflow into orchestrate tool and run tests.");
    expect(prompt).toContain("Your previous incomplete response:");
    expect(prompt).toContain("Let me check the exact line numbers and understand the gap.");
    expect(prompt).toContain("Continuation reason: deferral_language.");
  });
});
