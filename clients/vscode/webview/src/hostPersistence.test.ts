import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The host store (`createHostPersistence` → the extension host's `createLocalBrainPersistence`)
 * is only a fix if the panel actually reaches for it. The original bug
 * was entirely in this wiring — every unit was correct — so the wiring is asserted at
 * source level, the same way `modelRouting.test.ts` guards the routing seam.
 */
describe("the panel is wired to it", () => {
  // `App.tsx` until the chat/canvas merge: the panel's root moved to `WorkspaceApp`
  // when chat became a SURFACE of the one canvas, and the runtime moved with it into
  // `ChatRuntimeProvider` there. Same wiring, same assertions, one file along.
  const app = readFileSync(join(__dirname, "WorkspaceApp.tsx"), "utf8");

  it("writes chat history to the extension host's local store, signed in or out", () => {
    expect(app).toContain("createHostPersistence");
    // One store for every account state: a branch back to the gateway adapter would make
    // a signed-out (on-device) turn 401 on the user-turn write before the model is reached.
    expect(app).not.toMatch(/persistence:\s*signedOut/);
    expect(app).not.toContain("createPersistence(init.baseUrl");
  });

  it("keeps one store per panel rather than one per render", () => {
    // The adapter holds attachment preview URLs; rebuilding it inside the runtime memo
    // would blank every image already in the conversation on a token re-mint.
    expect(app).toContain("useState(createHostPersistence)");
    const deps = app.match(/\[init\.baseUrl,[^\]]*init\.grounding[^\]]*\]/);
    expect(deps?.[0]).toContain("persistence");
  });
});
