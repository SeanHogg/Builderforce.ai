import { vi } from "vitest";

vi.mock("../agents/embedded.js", () => ({
  abortEmbeddedRun: vi.fn().mockReturnValue(false),
  runEmbeddedAgent: vi.fn(),
  resolveEmbeddedSessionLane: (key: string) => `session:${key.trim() || "main"}`,
}));

vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(),
}));

vi.mock("../agents/subagent-announce.js", () => ({
  runSubagentAnnounceFlow: vi.fn(),
}));
