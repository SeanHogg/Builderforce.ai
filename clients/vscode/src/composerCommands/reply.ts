/**
 * What a composer command answers in the chat (PRD 31 §W11, "Local launch from the VSIX").
 *
 * Pure types, no `vscode`: the extension host builds a reply and the webview renders it
 * as a HOST message beside the transcript — never a model turn. Shared by both sides the
 * way `bridgeProtocol.ts` is.
 */
import type { ComposerHelpModel } from "@seanhogg/builderforce-brain-embedded/composerCommands";

/** A follow-up the reply offers: running another composer command (e.g. `/launch external` to open the system browser). */
export interface ComposerReplyAction {
  label: string;
  /** The command line to run, exactly as if typed (`/launch`). */
  command: string;
}

export type ComposerReply =
  /** `/help`, an unknown command, or a typo's syntax: the registry's help model, rendered as a list. */
  | { kind: "help"; help: ComposerHelpModel; lines?: string[] }
  /** A command's outcome or refusal, already worded in the person's language. */
  | { kind: "text"; tone: "info" | "error"; lines: string[]; link?: string; actions?: ComposerReplyAction[] };

/** The host's answer to a composer line: not a command (send it to the chat as usual), or the reply to show. */
export type ComposerInputResult =
  | { handled: false; text?: string }
  | { handled: true; reply: ComposerReply };

/** What the webview receives with `init` to draw the `/` menu's Actions tab. */
export interface ComposerCommandsInit {
  help: ComposerHelpModel;
}
