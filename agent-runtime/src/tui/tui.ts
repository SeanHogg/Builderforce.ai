/**
 * Back-compat launch seam for the TUI.
 *
 * The legacy pi-tui `tui.ts` (`runTui`) was deleted in the pi-tui → Ink
 * migration (PRD 11 §5.1 Stage 4). This module keeps the `runTui` export and
 * option shape so existing callers (`commands/builderforce.ts`,
 * `wizard/onboarding.finalize.ts`, `cli/tui-cli.ts`) and their test mocks
 * keep working, while the implementation underneath is the pi-free Ink
 * session (`ink-session.ts` via the `@builderforce/tui` render seam).
 */
import { GatewayChatClient } from "./gateway-chat.js";
import { wireInkSession } from "./ink-session.js";
import { resolveTuiRenderer } from "./renderer-registry.js";

export type RunTuiOptions = {
  url?: string;
  token?: string;
  password?: string;
  session?: string;
  deliver?: boolean;
  thinking?: string;
  message?: string;
  timeoutMs?: number;
  historyLimit?: number;
};

/**
 * Launch the live TUI session against the gateway. Mirrors the behaviour of
 * the deleted pi-tui `runTui`: connects, renders, and — when `message` is
 * given — sends it as the first turn once the session is ready.
 */
export async function runTui(options: RunTuiOptions = {}): Promise<void> {
  const sessionKey = options.session?.trim() || "main";
  const renderer = resolveTuiRenderer();
  const client = new GatewayChatClient({
    url: options.url,
    token: options.token,
    password: options.password,
  });
  wireInkSession({
    renderer,
    client,
    sessionKey,
    showThinking: typeof options.thinking === "string" && options.thinking !== "off",
  });
  client.start();
  renderer.start({ title: "BuilderForce Agents" });
  await client.waitForReady();
  const initialMessage = options.message?.trim();
  if (initialMessage) {
    await client.sendChat({ sessionKey, message: initialMessage });
  }
}
