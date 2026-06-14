import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runTui } from "../tui/tui.js";
import { parseTimeoutMs } from "./parse-timeout.js";

export function registerTuiCli(program: Command) {
  program
    .command("tui")
    .description("Open a terminal UI connected to the Gateway")
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--password <password>", "Gateway password (if required)")
    .option("--session <key>", 'Session key (default: "main", or "global" when scope is global)')
    .option("--deliver", "Deliver assistant replies", false)
    .option("--thinking <level>", "Thinking level override")
    .option("--message <text>", "Send an initial message after connecting")
    .option("--timeout-ms <ms>", "Agent timeout in ms (defaults to agents.defaults.timeoutSeconds)")
    .option("--history-limit <n>", "History entries to load", "200")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/tui", "docs.builderforce.ai/cli/tui")}\n`,
    )
    .action(async (opts) => {
      try {
        // Pre-launch setup detection — mirrors Claude Code's approach.
        // If config is missing or no model is configured, run the onboarding
        // wizard inline before the TUI starts.
        // Skip when spawned from handleSetup (already ran wizard there).
        const { checkIfSetupNeeded } = await import("../tui/tui-setup-check.js");
        const setupCheck =
          process.env.BUILDERFORCE_AGENTS_SKIP_SETUP_CHECK === "1"
            ? ({ needed: false } as const)
            : await checkIfSetupNeeded();
        if (setupCheck.needed) {
          defaultRuntime.log(theme.muted(setupCheck.hint));
          const { runInteractiveOnboarding } = await import("../commands/onboard-interactive.js");
          await runInteractiveOnboarding({ flow: "quickstart" });
          // After onboarding, try to start the gateway if it isn't running
          // (daemon install may have failed on Windows without admin rights).
          const { startGatewayBackground } = await import("../tui/tui-setup-check.js");
          const started = await startGatewayBackground();
          if (!started) {
            defaultRuntime.log(
              theme.muted("Gateway not reachable yet — TUI will retry when it connects."),
            );
          }
          // Fall through to launch the TUI. If the wizard launched its own TUI
          // (user picked "Hatch in TUI"), that session has already exited; we
          // start a fresh one below.
        }

        const timeoutMs = parseTimeoutMs(opts.timeoutMs);
        if (opts.timeoutMs !== undefined && timeoutMs === undefined) {
          defaultRuntime.error(
            `warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`,
          );
        }
        const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);

        // Opt-in: the pi-free `ink` TUI wired through the `@builderforce/tui` render seam
        // (PRD 11 §5.1 Stage 4). Reachable today; becomes the default once it reaches
        // feature parity with the legacy pi-tui `runTui` and `@mariozechner/pi-tui` is dropped.
        if (process.env.BUILDERFORCE_AGENTS_INK_TUI === "1") {
          const { runInkSession } = await import("../tui/ink-session.js");
          await runInkSession({
            sessionKey: (opts.session as string | undefined)?.trim() || "main",
            connection: {
              url: opts.url as string | undefined,
              token: opts.token as string | undefined,
              password: opts.password as string | undefined,
            },
            showThinking: typeof opts.thinking === "string" && opts.thinking !== "off",
          });
          return;
        }

        await runTui({
          url: opts.url as string | undefined,
          token: opts.token as string | undefined,
          password: opts.password as string | undefined,
          session: opts.session as string | undefined,
          deliver: Boolean(opts.deliver),
          thinking: opts.thinking as string | undefined,
          message: opts.message as string | undefined,
          timeoutMs,
          historyLimit: Number.isNaN(historyLimit) ? undefined : historyLimit,
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
