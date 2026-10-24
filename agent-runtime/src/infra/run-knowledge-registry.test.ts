import { afterEach, describe, expect, it } from "vitest";
import {
  claimRunKnowledge,
  isRunKnowledgeFedByLoop,
  releaseRunKnowledge,
  resetRunKnowledgeForTest,
  runKnowledgeFor,
} from "./run-knowledge-registry.js";

describe("run-knowledge-registry", () => {
  afterEach(() => resetRunKnowledgeForTest());

  it("hands the loop and the knowledge loop ONE recorder per run", () => {
    const loop = claimRunKnowledge("run-1", "fix the canvas");
    const observer = runKnowledgeFor("run-1");
    expect(observer).toBe(loop);
    loop.record("read_file", { path: "web/src/a.ts" });
    expect(observer.activity.read).toEqual(["web/src/a.ts"]);
    expect(observer.activity.prompt).toBe("fix the canvas");
  });

  it("marks the run as fed by the loop only once the loop claims it", () => {
    runKnowledgeFor("run-2", "observe me");
    expect(isRunKnowledgeFedByLoop("run-2")).toBe(false);
    claimRunKnowledge("run-2");
    expect(isRunKnowledgeFedByLoop("run-2")).toBe(true);
    expect(runKnowledgeFor("run-2").activity.prompt).toBe("observe me");
  });

  it("keeps a retry attempt on the same record until the run is released", () => {
    const first = claimRunKnowledge("run-3");
    expect(claimRunKnowledge("run-3")).toBe(first);
    releaseRunKnowledge("run-3");
    expect(isRunKnowledgeFedByLoop("run-3")).toBe(false);
    expect(runKnowledgeFor("run-3")).not.toBe(first);
  });
});
