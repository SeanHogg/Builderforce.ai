/**
 * Operator decision 2026-11-15: nothing knowledge-related runs at activation. The background indexer is wired only once a
 * Visualizer's Run makes a root run (or the autoIndex opt-in is on), and unwired when the last one stops.
 *
 * Evidence re-verification: busts the verify cache (content-hash key) so the pre-push
 * gate re-runs checks against the repaired install instead of replaying a stale record.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const disposable = () => ({ dispose: vi.fn() });
  return {
    autoIndex: undefined as boolean | undefined,
    typing: vi.fn(() => disposable()),
    disposable,
  };
});

vi.mock("vscode", () => {
  const d = () => mocks.disposable();
  return {
    workspace: {
      getConfiguration: () => ({ get: (_k: string, fallback: boolean) => mocks.autoIndex ?? fallback }),
      onDidChangeConfiguration: d,
      onDidChangeWorkspaceFolders: d,
      onDidChangeTextDocument: mocks.typing,
    },
    window: {
      state: { focused: true },
      visibleTextEditors: [],
      tabGroups: { all: [], onDidChangeTabs: d },
      onDidChangeTextEditorSelection: d,
      onDidChangeActiveTextEditor: d,
      onDidChangeVisibleTextEditors: d,
      onDidChangeWindowState: d,
    },
    TabInputText: class {},
  };
});
vi.mock("../telemetry/productEvents", () => ({ emitProductEvent: vi.fn() }));
vi.mock("../errorReporter", () => ({ logLine: vi.fn() }));
vi.mock("../power/powerSource", () => ({ osPowerSource: () => ({ current: async () => "mains" }) }));
vi.mock("./indexHostPorts", () => ({ hostIndexPorts: vi.fn() }));
vi.mock("./activeRuns", () => ({ onRunStarted: () => () => undefined }));
vi.mock("./knowledgeService", () => ({ log: vi.fn(), workspaceFolders: () => [] }));
vi.mock("./knowledgeFs", () => ({ vscodeKnowledgeFs: () => ({}) }));
vi.mock("./folderKnowledge", () => ({ beforeKnowledgeShutdown: () => () => undefined }));

import { startBackgroundIndexer } from "./backgroundIndexer";
import { STOP_GRACE_MS, resetVisualizerSessions, visualizerSessions } from "./visualizerSession";

const context = { secrets: {} } as never;

afterEach(() => { resetVisualizerSessions(); mocks.autoIndex = undefined; vi.clearAllMocks(); vi.useRealTimers(); });

describe("startBackgroundIndexer — wired to when knowledge runs", () => {
  it("activation starts nothing; a Run wires the indexer; the last Visualizer closing unwires it", async () => {
    vi.useFakeTimers();
    const handle = startBackgroundIndexer(context);
    expect(mocks.typing).not.toHaveBeenCalled(); // no indexer, so nothing listens to typing
    visualizerSessions.start("vscode:root");
    expect(mocks.typing).toHaveBeenCalledTimes(1);
    const typingSub = mocks.typing.mock.results[0]!.value as { dispose: ReturnType<typeof vi.fn> };
    visualizerSessions.stop("vscode:root");
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS);
    expect(typingSub.dispose).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it("the autoIndex opt-in starts it at activation", () => {
    mocks.autoIndex = true;
    const handle = startBackgroundIndexer(context);
    expect(mocks.typing).toHaveBeenCalledTimes(1);
    handle.dispose();
  });
});
