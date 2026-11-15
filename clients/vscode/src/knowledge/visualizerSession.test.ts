/**
 * Evidence re-verification: busts the verify cache (content-hash key) so the pre-push
 * gate re-runs checks against the repaired install instead of replaying a stale record.
 */
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ autoIndex: undefined as boolean | undefined, folders: [] as Array<{ path: string }> }));

vi.mock("vscode", () => ({
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: boolean) => mocks.autoIndex ?? fallback }) },
}));
vi.mock("./knowledgeService", () => ({ workspaceFolders: () => mocks.folders }));

import { rootForPath } from "./knowledgeRoots";
import { STOP_GRACE_MS, indexesFolder, knowledgeRunsAt, resetVisualizerSessions, visualizerSessions } from "./visualizerSession";

const folder = path.resolve(process.cwd(), "fixture-folder");
const other = path.resolve(process.cwd(), "other-folder");

afterEach(() => { resetVisualizerSessions(); mocks.autoIndex = undefined; mocks.folders = []; });

describe("visualizerSession — THE gate for knowledge work", () => {
  it("a root runs from the first start until a grace after its LAST stop; listeners hear only the edges", () => {
    vi.useFakeTimers();
    try {
      const heard: Array<[string, boolean]> = [];
      visualizerSessions.onChange((rootId, running) => heard.push([rootId, running]));
      visualizerSessions.start("r");
      visualizerSessions.start("r"); // a second panel on the same root
      expect(visualizerSessions.runningRoots()).toContain("r");
      visualizerSessions.stop("r");
      visualizerSessions.stop("r");
      visualizerSessions.stop("r"); // a stop without a start is ignored
      expect(visualizerSessions.runningRoots()).toContain("r"); // in its stop grace
      vi.advanceTimersByTime(STOP_GRACE_MS);
      expect(visualizerSessions.runningRoots()).not.toContain("r");
      expect(heard).toEqual([["r", true], ["r", false]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a re-subscribe inside the grace (unlive then live) never stops the root", () => {
    vi.useFakeTimers();
    try {
      const heard: Array<[string, boolean]> = [];
      visualizerSessions.onChange((rootId, running) => heard.push([rootId, running]));
      visualizerSessions.start("r");
      visualizerSessions.stop("r");
      visualizerSessions.start("r");
      vi.advanceTimersByTime(STOP_GRACE_MS * 2);
      expect(visualizerSessions.runningRoots()).toContain("r");
      expect(heard).toEqual([["r", true]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("nothing runs by default: no folder is indexed and no save re-seeds (autoIndex defaults OFF)", () => {
    mocks.folders = [{ path: folder }];
    const root = rootForPath(folder, mocks.folders)!;
    expect(indexesFolder(root)).toBe(false);
    expect(knowledgeRunsAt(path.join(folder, "a.ts"))).toBe(false);
  });

  it("a running root's folder is indexed and its files re-seed; another folder's do not", () => {
    mocks.folders = [{ path: folder }, { path: other }];
    const root = rootForPath(folder, mocks.folders)!;
    const otherRoot = rootForPath(other, mocks.folders)!;
    visualizerSessions.start(root.rootId);
    expect(indexesFolder(root)).toBe(true);
    expect(indexesFolder(otherRoot)).toBe(false);
    expect(knowledgeRunsAt(path.join(folder, "src", "a.ts"))).toBe(true);
    expect(knowledgeRunsAt(path.join(other, "a.ts"))).toBe(false);
  });

  it("the autoIndex opt-in counts every folder as running", () => {
    mocks.autoIndex = true;
    mocks.folders = [{ path: folder }];
    expect(indexesFolder(rootForPath(folder, mocks.folders)!)).toBe(true);
    expect(knowledgeRunsAt(path.join(folder, "a.ts"))).toBe(true);
  });
});
