import { describe, expect, it } from "vitest";
import { logReviewFailure } from "./knowledgeFailureLog";

const sink = () => {
  const lines: string[] = [];
  return { lines, sink: { log: (line: string) => lines.push(line), host: "BuilderForce for VS Code 1.2.3", now: () => new Date("2026-10-30T12:00:00.000Z") } };
};

describe("logReviewFailure", () => {
  it("logs the time, root, review, phase, message and stack, and returns the detail the view is sent", () => {
    const { lines, sink: s } = sink();
    const error = new Error("disk full");
    const sent = logReviewFailure(s, { stage: "review", reviewId: "review-7", rootId: "vscode:ws", rootPath: "/work/docs", lastPhase: "judge" }, error);

    expect(lines).toHaveLength(1);
    const logged = lines[0]!;
    expect(logged).toContain("[2026-10-30T12:00:00.000Z] knowledge review failed");
    expect(logged).toContain("root: vscode:ws (/work/docs)");
    expect(logged).toContain("review: review-7");
    expect(logged).toContain("phase: judge");
    expect(logged).toContain("message: disk full");
    expect(logged).toContain("Error: disk full");
    expect(sent).toEqual({ error: "disk full", detail: error.stack, host: "BuilderForce for VS Code 1.2.3", rootPath: "/work/docs" });
  });

  it("logs a plan failure with no review id or phase, and copes with a thrown string", () => {
    const { lines, sink: s } = sink();
    const sent = logReviewFailure(s, { stage: "plan", rootId: "vscode:ws" }, "no folder");

    expect(lines[0]).toContain("knowledge plan failed");
    expect(lines[0]).toContain("review: (none)");
    expect(lines[0]).toContain("phase: (none)");
    expect(lines[0]).toContain("message: no folder");
    expect(sent).toEqual({ error: "no folder", detail: "no folder", host: "BuilderForce for VS Code 1.2.3" });
  });
});
