import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const item = vi.hoisted(() => ({
  text: "",
  tooltip: "",
  name: "",
  command: "" as string | undefined,
  visible: false,
  show() { item.visible = true; },
  hide() { item.visible = false; },
  dispose() { /* noop */ },
}));

vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  window: { createStatusBarItem: () => item },
  l10n: { t: (message: string) => message },
}));

import { createPlatformHealth } from "./bfApi/platformHealth";
import { registerPlatformHealthStatus } from "./platformHealthStatus";

describe("platform health status item", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    item.visible = false;
    item.text = "";
  });
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const health = createPlatformHealth();
    const subscriptions: Array<{ dispose(): void }> = [];
    registerPlatformHealthStatus({ subscriptions } as never, health, 5000);
    return { health, subscriptions };
  };

  it("is hidden while online and wired to Diagnose", () => {
    setup();
    expect(item.visible).toBe(false);
    expect(item.command).toBe("builderforce.diagnose");
  });

  it("shows degraded only after the state persists", () => {
    const { health } = setup();
    health.reportResponse(503);
    vi.advanceTimersByTime(4999);
    expect(item.visible).toBe(false);
    vi.advanceTimersByTime(1);
    expect(item.visible).toBe(true);
    expect(item.text).toContain("degraded");
    expect(item.tooltip).toContain("local models");
  });

  it("does not flap on a blip that recovers inside the delay", () => {
    const { health } = setup();
    health.reportUnreachable();
    vi.advanceTimersByTime(2000);
    health.reportResponse(200);
    vi.advanceTimersByTime(10_000);
    expect(item.visible).toBe(false);
  });

  it("switches to offline immediately once shown, and hides immediately on recovery", () => {
    const { health } = setup();
    health.reportResponse(503);
    vi.advanceTimersByTime(5000);
    health.reportUnreachable();
    expect(item.text).toContain("offline");
    health.reportResponse(200);
    expect(item.visible).toBe(false);
  });
});
