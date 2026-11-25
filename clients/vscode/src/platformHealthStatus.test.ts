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

import { BAD_SUSTAINED_MS, RECOVERY_MS, createPlatformHealth } from "./bfApi/platformHealth";
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
    registerPlatformHealthStatus({ subscriptions } as never, health);
    return { health, subscriptions };
  };

  it("is hidden while online and wired to Diagnose", () => {
    setup();
    expect(item.visible).toBe(false);
    expect(item.command).toBe("builderforce.diagnose");
  });

  it("shows degraded once two non-online answers land within 30s", () => {
    const { health } = setup();
    health.reportResponse(503);
    expect(item.visible).toBe(false);
    health.reportResponse(503);
    expect(item.visible).toBe(true);
    expect(item.text).toContain("degraded");
    expect(item.tooltip).toContain("local models");
  });

  it("shows a single sustained failure after 5s", () => {
    const { health } = setup();
    health.reportUnreachable();
    vi.advanceTimersByTime(BAD_SUSTAINED_MS - 1);
    expect(item.visible).toBe(false);
    vi.advanceTimersByTime(1);
    expect(item.visible).toBe(true);
    expect(item.text).toContain("offline");
  });

  it("does not flap on a blip that recovers", () => {
    const { health } = setup();
    health.reportUnreachable();
    vi.advanceTimersByTime(2000);
    health.reportResponse(200);
    vi.advanceTimersByTime(60_000);
    expect(item.visible).toBe(false);
  });

  it("stays visible through a lone good answer and hides only after 30s of continuous online answers", () => {
    const { health } = setup();
    health.reportResponse(503);
    health.reportResponse(503);
    health.reportUnreachable();
    expect(item.text).toContain("offline");
    health.reportResponse(200);
    expect(item.visible).toBe(true);
    vi.advanceTimersByTime(RECOVERY_MS - 1);
    expect(item.visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(item.visible).toBe(false);
  });
});
