import { describe, expect, it } from "vitest";
import { buildVisualizationInitFrame, type VisualizationInitInput } from "./visualizationInitFrame";

/**
 * What the HOST sends the visualization webview.
 *
 * The regression these pin is the one that cost this feature twice: the panel opened,
 * everything type-checked, the command existed — and the webview sat on "Connecting…"
 * forever because no `ready` frame was ever answered. Nothing in the build could see
 * that, so the frame itself is asserted here.
 */

function input(overrides: Partial<VisualizationInitInput> = {}): VisualizationInitInput {
  return {
    locale: "en",
    colorTheme: "dark",
    labels: { "canvas.degraded": "The board could not be drawn." },
    session: { id: "sess_42", title: "Creation Session", durable: true },
    signedIn: true,
    token: "jwt-abc",
    baseUrl: "https://api.builderforce.ai",
    webOrigin: "https://builderforce.ai",
    project: { id: 11, name: "BuilderForce.AI" },
    pendingChanges: { files: [{ path: "src/a.ts", status: "modified" }] },
    ...overrides,
  };
}

describe("buildVisualizationInitFrame", () => {
  it("routes the webview to the visualization screen, not the workspace chat", () => {
    const frame = buildVisualizationInitFrame(input());
    // The React root branches on `view` in WorkspaceApp. Anything else renders the
    // CHAT — a panel that opens, draws, and is the wrong product.
    expect(frame.view).toBe("visualization");
    expect(frame.type).toBe("init");
  });

  it("carries the session the canvas needs to draw a board", () => {
    const frame = buildVisualizationInitFrame(input());
    expect(frame.session).toEqual({
      id: "sess_42",
      title: "Creation Session",
      webOrigin: "https://builderforce.ai",
      durable: true,
    });
    // The panel shows the session the chat is working in — one board, not a fork.
    expect(frame.session.id).toBe("sess_42");
  });

  it("omits `surface` so the board keeps the user's own surface preference", () => {
    const frame: Record<string, unknown> = { ...buildVisualizationInitFrame(input()) };
    expect("surface" in frame).toBe(false);
  });

  it("still boots signed out — the board is where an on-device user works", () => {
    const frame = buildVisualizationInitFrame(
      input({ signedIn: false, token: null, session: { id: "local_1", title: "Local", durable: false } }),
    );
    expect(frame.signedIn).toBe(false);
    expect(frame.token).toBeNull();
    // The webview picks local persistence off this flag.
    expect(frame.session.durable).toBe(false);
    expect(frame.view).toBe("visualization");
  });

  it("passes the working tree through, and omits the key entirely with no git", () => {
    expect(buildVisualizationInitFrame(input()).pendingChanges).toEqual({
      files: [{ path: "src/a.ts", status: "modified" }],
    });
    // Absent, not `undefined`-valued: `bridgeState` seeds from this key.
    const noGit: Record<string, unknown> = { ...buildVisualizationInitFrame(input({ pendingChanges: undefined })) };
    expect("pendingChanges" in noGit).toBe(false);
  });

  it("sends every label the canvas reads, or the board prints raw keys", () => {
    const labels = { "canvas.degraded": "x", "canvas.retry": "Try again", "chat.send": "Send" };
    expect(buildVisualizationInitFrame(input({ labels })).labels).toEqual(labels);
  });

  it("defaults a missing project to null instead of dropping the key", () => {
    const frame = buildVisualizationInitFrame(input({ project: undefined }));
    expect(frame.project).toBeNull();
    expect("project" in frame).toBe(true);
  });
});