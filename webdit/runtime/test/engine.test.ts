import { vi, describe, it, expect, beforeEach } from "vitest";
import type { LoadedBundle } from "../src/bundle";
import type { VideoGenerateResult } from "../src/types";

vi.mock("../src/bundle", () => ({
  loadBundle: vi.fn(),
}));
vi.mock("../src/ort-runner", () => ({
  runDenoiseLoop: vi.fn(),
}));

import { withVideo } from "../src/engine";
import { loadBundle } from "../src/bundle";
import { runDenoiseLoop } from "../src/ort-runner";

const fakeBundle = (): LoadedBundle =>
  ({
    manifest: {} as never,
    dit: {} as never,
    textEncoder: {} as never,
    vae: {} as never,
    tokenizer: {} as never,
    unload: vi.fn().mockResolvedValue(undefined),
  }) as unknown as LoadedBundle;

const emptyResult: VideoGenerateResult = {
  frames: [],
  width: 0,
  height: 0,
  elapsedMs: 0,
};

describe("withVideo", () => {
  beforeEach(() => {
    vi.mocked(loadBundle).mockReset();
    vi.mocked(runDenoiseLoop).mockReset();
  });

  it("attaches .video without disturbing existing engine properties", async () => {
    vi.mocked(loadBundle).mockResolvedValue(fakeBundle());
    const original = { chat: { completions: { create: vi.fn() } } };
    const result = await withVideo(original as never, { bundleUrl: "https://x/" });
    expect(result).toBe(original);
    expect(result.video).toBeDefined();
    expect(result.video.generate).toBeTypeOf("function");
    expect(result.video.unload).toBeTypeOf("function");
    expect(result.chat).toBe(original.chat);
  });

  it("video.generate delegates to runDenoiseLoop with the loaded bundle", async () => {
    const bundle = fakeBundle();
    vi.mocked(loadBundle).mockResolvedValue(bundle);
    vi.mocked(runDenoiseLoop).mockResolvedValue(emptyResult);
    const engine = await withVideo({} as never, { bundleUrl: "https://x/" });
    const req = { prompt: "hi" };
    const out = await engine.video.generate(req);
    expect(runDenoiseLoop).toHaveBeenCalledWith(bundle, req);
    expect(out).toEqual(emptyResult);
  });

  it("video.unload delegates to bundle.unload", async () => {
    const bundle = fakeBundle();
    vi.mocked(loadBundle).mockResolvedValue(bundle);
    const engine = await withVideo({} as never, { bundleUrl: "https://x/" });
    await engine.video.unload();
    expect(bundle.unload).toHaveBeenCalledOnce();
  });

  it("propagates loadBundle errors instead of attaching an unusable namespace", async () => {
    vi.mocked(loadBundle).mockRejectedValue(new Error("manifest 404"));
    const engine = {} as Record<string, unknown>;
    await expect(withVideo(engine as never, { bundleUrl: "x" })).rejects.toThrow(/manifest 404/);
    expect(engine.video).toBeUndefined();
  });
});
