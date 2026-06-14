import { vi } from "vitest";

vi.mock("../agents/embedded.js", () => ({
  abortEmbeddedRun: vi.fn().mockReturnValue(false),
  runEmbeddedAgent: vi.fn(),
  queueEmbeddedMessage: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: (key: string) => `session:${key.trim() || "main"}`,
  isEmbeddedRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedRunStreaming: vi.fn().mockReturnValue(false),
}));

vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(),
}));
