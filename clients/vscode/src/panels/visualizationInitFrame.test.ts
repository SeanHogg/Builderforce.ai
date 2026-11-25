import { describe, expect, it } from "vitest";
import { asVisualizationFrame, type WorkspaceInitFrame } from "./visualizationInitFrame";

/**
 * What the HOST sends the visualization webview.
 *
 * Two regressions cost this feature: first the panel answered no `ready` at all and sat
 * on "Connecting…"; then it answered with a narrow frame of its own and the board it
 * mounted failed to draw. The frame is now the workspace frame, re-addressed — these
 * pin the re-addressing.
 */

function workspaceFrame(overrides: WorkspaceInitFrame = {}): WorkspaceInitFrame {
  return {
    type: "init",
    locale: "en",
    colorTheme: "dark",
    labels: { "canvas.degraded": "The board could not be drawn." },
    session: { id: "sess_42", title: "Creation Session", webOrigin: "https://builderforce.ai", durable: true },
    surface: "graph",
    signedIn: true,
    token: "jwt-abc",
    baseUrl: "https://api.builderforce.ai",
    model: "auto",
    project: { id: 11, name: "BuilderForce.AI" },
    pendingChanges: { files: [{ path: "src/a.ts", status: "modified" }] },
    ...overrides,
  };
}

describe("asVisualizationFrame", () => {
  it("routes the webview to the visualization screen, not the workspace chat", () => {
    const frame = asVisualizationFrame(workspaceFrame());
    // The React root branches on `view` in WorkspaceApp. Anything else renders the
    // CHAT — a panel that opens, draws, and is the wrong product.
    expect(frame.view).toBe("visualization");
    expect(frame.type).toBe("init");
  });

  it("carries the session the canvas needs to draw a board", () => {
    const frame = asVisualizationFrame(workspaceFrame());
    // The panel shows the session the chat is working in — one board, not a fork.
    expect(frame.session).toEqual({
      id: "sess_42",
      title: "Creation Session",
      webOrigin: "https://builderforce.ai",
      durable: true,
    });
  });

  it("keeps everything the canvas's runtime reads — the frame is the workspace's, not a subset", () => {
    const frame = asVisualizationFrame(workspaceFrame());
    expect(frame.model).toBe("auto");
    expect(frame.baseUrl).toBe("https://api.builderforce.ai");
    expect(frame.project).toEqual({ id: 11, name: "BuilderForce.AI" });
  });

  it("omits `surface` so the board keeps the user's own surface preference", () => {
    expect("surface" in asVisualizationFrame(workspaceFrame())).toBe(false);
  });

  it("omits `boardBeside`, which would render the sidebar chat instead of the board", () => {
    expect("boardBeside" in asVisualizationFrame(workspaceFrame({ boardBeside: true }))).toBe(false);
  });

  it("still boots signed out — the board is where an on-device user works", () => {
    const frame = asVisualizationFrame(
      workspaceFrame({ signedIn: false, token: null, session: { id: "local_1", title: "Local", webOrigin: "https://builderforce.ai", durable: false } }),
    );
    expect(frame.signedIn).toBe(false);
    expect(frame.token).toBeNull();
    expect((frame.session as { durable: boolean }).durable).toBe(false);
    expect(frame.view).toBe("visualization");
  });

  it("passes the working tree through, and omits the key entirely with no git", () => {
    expect(asVisualizationFrame(workspaceFrame()).pendingChanges).toEqual({
      files: [{ path: "src/a.ts", status: "modified" }],
    });
    // Absent, not `undefined`-valued: `bridgeState` seeds from this key.
    expect("pendingChanges" in asVisualizationFrame(workspaceFrame({ pendingChanges: undefined }))).toBe(false);
  });

  it("sends every label the canvas reads, or the board prints raw keys", () => {
    const labels = { "canvas.degraded": "x", "canvas.retry": "Try again", "chat.send": "Send" };
    expect(asVisualizationFrame(workspaceFrame({ labels })).labels).toEqual(labels);
  });
});
