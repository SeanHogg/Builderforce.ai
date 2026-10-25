import * as vscode from "vscode";
import { createBuilderForceHandler } from "./chatParticipant";
import { localBrainApplication } from "./localFirstStore";
import type { BrainRunHost } from "./brainRunHost";

const SESSION_TYPE = "builderforce";
/** The id `registerChatParticipant` creates the participant under. The session tab binds
 *  to that same agent so `@builderforce` and the tab are ONE agent, not two. */
const PARTICIPANT_ID = "builderforce.agent";

/**
 * Registers BuilderForce as a dedicated chat-session tab (like CLAUDE CODE / CODEX),
 * reusing the same agent handler.
 *
 * ## Which API this actually uses, and why (verified against the vendored 1.140.0 build)
 *
 * The agent-picker tab is contributed DECLARATIVELY, via `contributes.chatSessions` in
 * package.json — the same shape the built-in Copilot extension uses for its own
 * `copilotcli` / `copilot-cloud-agent` tabs (see
 * `.vscode-test/.../resources/app/extensions/copilot/package.json`). There is no runtime
 * "add a tab" call; this function is only the RUNTIME BINDING that supplies the content
 * for the declaratively-declared `type`.
 *
 * That declarative point, like the runtime `registerChatSessionContentProvider`, is gated
 * behind the `chatSessionsProvider` PROPOSED api: the workbench consumes contributions as
 * `if (Ac(g.description, "chatSessionsProvider") && Array.isArray(g.value))`, and the
 * runtime wrapper opens with `L(P, "chatSessionsProvider")`, which THROWS if the extension
 * has not been granted the proposal (`workbench.desktop.main.js`, `extensionHostProcess.js`).
 *
 * ## The gating is NOT something package.json alone can satisfy (verified 2026-10-18)
 *
 * This is the part worth knowing, because it is easy to get backwards. package.json declares
 * `"enabledApiProposals": ["chatSessionsProvider"]`, but on a packaged STABLE build the
 * workbench STRIPS that declaration:
 *
 *   doUpdateEnabledApiProposals() — `!this._envEnablesProposedApiForAll
 *     && !this._envEnabledExtensions.has(e) && !o.isBuiltin && vs(o.enabledApiProposals)`
 *   → `o.enabledApiProposals = []`, with the error
 *     "Extension X CANNOT USE these API proposals ... you MUST start in extension
 *      development mode or use the --enable-proposed-api command line flag"
 *
 * and `_envEnablesProposedApiForAll = !isBuilt || (isExtensionDevelopment && quality !==
 * "stable")`. A normal VS Code install is built AND stable, so both escape hatches are
 * closed. What Copilot has that we do not is `product.json#extensionEnabledApiProposals`,
 * which the same function honours ahead of everything else:
 *
 *   if (this._productEnabledExtensions.has(e)) { ... product.json WINS ... }
 *
 * That map contains `GitHub.copilot-chat`, `GitHub.vscode-pull-request-github` and
 * `openai.chatgpt` — and NOT `builderforce.builderforce-ai`, which we cannot edit.
 *
 * CONSEQUENCE: the manifest is necessary but NOT sufficient. On an ordinary install the
 * tab does not appear, and no change to this file can make it. It appears when VS Code
 * launches with `--enable-proposed-api builderforce.builderforce-ai` (the one lever we
 * actually control). Claiming otherwise here previously sent users chasing a flag or a
 * manifest edit that would not work.
 *
 * The API is still proposed, so it is feature-detected rather than imported from types:
 * the vendored `vscode.d.ts` ships NO `chatSession*` symbols at all, and a stable build
 * (or one too old to know the proposal) must still run the extension. Note that the
 * detection below is NOT sufficient on its own — the methods EXIST on the `vscode.chat`
 * namespace of a stable build and only throw when CALLED, which is why the call site
 * below is also guarded.
 *
 * ## Decision: the two per-tab surfaces do NOT converge (recorded 2026-08-20)
 *
 * The open question was whether this and the stable `BuilderForcePanel` per-session tabs
 * (`sessionTabs:perSession`) should collapse into one implementation if VS Code ever
 * promotes `chatSessionsProvider` to stable. They should not, and the reason is that they
 * were never two implementations of one thing:
 *
 *  - This file is a REGISTRATION ADAPTER. It owns no chat logic: every turn is
 *    served by {@link createBuilderForceHandler}, the exact handler the stable
 *    `@builderforce` participant uses. There is no duplicated loop, tool wiring, model
 *    resolution or persistence here to converge — that consolidation already happened.
 *  - `BuilderForcePanel` is a different SURFACE, not a second copy of this one. It carries what
 *    the native chat UI has no contract for: the Evermind console, the model picker, the
 *    creation canvas, per-chat project attachment, diagnostics capture. Retiring it to
 *    gain a native tab would delete features, not duplication.
 *
 * So promotion of the proposed API changes exactly one thing — the feature detection below
 * starts succeeding on stable builds — and nothing else. Keep both. This adapter stays
 * thin BY RULE: any behaviour that would need to live here belongs in the shared handler
 * instead, which is what keeps a second implementation from ever appearing.
 *
 * Returns a Disposable, or undefined when the proposed API isn't available.
 */
export function registerChatSessions(
  ctx: vscode.ExtensionContext,
  participant: vscode.ChatParticipant,
  runHost?: BrainRunHost,
): vscode.Disposable | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatApi = vscode.chat as any;
  if (typeof chatApi.registerChatSessionContentProvider !== "function") {
    console.log(
      "[BuilderForce] Dedicated chat tab unavailable: this VS Code build does not expose " +
        "the proposed `chatSessionsProvider` API. The tab needs VS Code 1.140+ launched with " +
        "`--enable-proposed-api builderforce.builderforce-ai` — our own manifest cannot " +
        "enable it, because on a packaged stable build the workbench strips any proposal the " +
        "extension is not allowlisted for in product.json (only GitHub/OpenAI are). The " +
        "sidebar and @builderforce are unaffected either way.",
    );
    return undefined;
  }

  const handler = createBuilderForceHandler(ctx, runHost);
  const disposables: vscode.Disposable[] = [];

  // The session LIST (the "SESSIONS" panel). Two API shapes exist mid-migration —
  // prefer the controller, fall back to the item provider; both are best-effort, and a
  // failure here must not cost the tab its content.
  try {
    if (typeof chatApi.createChatSessionItemController === "function") {
      const controller = chatApi.createChatSessionItemController(SESSION_TYPE, () => {
        /* refresh handler — items are managed by VS Code's New Session action */
      });
      disposables.push(controller as vscode.Disposable);
    } else if (typeof chatApi.registerChatSessionItemProvider === "function") {
      const changed = new vscode.EventEmitter<void>();
      disposables.push(changed);
      disposables.push(
        chatApi.registerChatSessionItemProvider(SESSION_TYPE, {
          onDidChangeChatSessionItems: changed.event,
          provideChatSessionItems: () => [],
        }) as vscode.Disposable,
      );
    }
  } catch (e) {
    console.error("[BuilderForce] chat-session list registration failed:", e);
  }

  // The session CONTENT (the actual chat in the tab) — bind the type to our agent.
  //
  // THIRD ARGUMENT IS THE CHAT PARTICIPANT, not a handle. The public wrapper is
  // `registerChatSessionContentProvider(I, S, D, Ce)` → `dn.registerChatSessionContentProvider(
  // ext, I, D, S, Ce)`, and the internal implementation stores `provider: D`, keyed by the
  // TYPE only — the third argument is the participant object Copilot's own shipped code
  // passes: `wc.chat.registerChatSessionContentProvider(this.copilotcliSessionType, c, B)`
  // where `B = wc.chat.createChatParticipant(...)` (extensions/copilot/dist/extension.js).
  //
  // This previously read a non-existent `participant.handle` property and bailed out, so
  // the tab was bound to NOTHING even where the proposal WAS granted. There is no `handle`
  // on the public ChatParticipant: the object returned by `createChatParticipant` exposes
  // id/iconPath/requestHandler/followupProvider/helpTextPrefix, and its `apiAgent` getter
  // returns a literal carrying the same fields — no handle anywhere.
  //
  // The call is guarded rather than merely feature-detected because on a stable build the
  // method EXISTS and the guard `L(P, "chatSessionsProvider")` throws only when called.
  try {
    const contentProvider = {
      provideChatSessionContent: async (resource: vscode.Uri) => ({
        title: titleFromResource(resource),
        history: await sessionHistory(ctx, resource),
        requestHandler: handler,
      }),
    };
    disposables.push(
      chatApi.registerChatSessionContentProvider(
        SESSION_TYPE,
        contentProvider,
        participant,
      ) as vscode.Disposable,
    );
  } catch (e) {
    console.error(
      "[BuilderForce] chat-session content registration failed. On a packaged stable " +
        "VS Code this is expected unless the extension was launched with " +
        "`--enable-proposed-api builderforce.builderforce-ai`; the sidebar and " +
        "@builderforce still work. Cause:",
      e,
    );
  }

  return disposables.length ? vscode.Disposable.from(...disposables) : undefined;
}

/**
 * The session's Brain chat id, carried ON the resource by the content provider so a
 * reopened tab reads its own transcript rather than the newest chat. Absent for a brand
 * new session, which then simply starts empty.
 */
function chatIdFromResource(resource: vscode.Uri): number | undefined {
  return readSessionId(resource.toString());
}

/**
 * Pull a positive chat id out of a session resource.
 *
 * WHERE the id lives was the thing to get right: it is the PATH, not the query. The
 * shipped Copilot session providers build resources as `copilotcli:/<sessionId>` and read
 * it back with `resource.path.split("/").pop()`
 * (`.vscode-test/.../extensions/copilot/dist/extension.js:3151,3165`), and the workbench
 * hands an extension-host provider a Uri whose query is empty. So a `query`-only parse
 * never matched anything and every reopened tab restored zero turns.
 *
 * Both forms are accepted because which one arrives is not ours to choose: VS Code
 * builds the resource for the declarative `contributes.chatSessions` tab, and any code
 * that reopens a session by hand may use either. Path is checked first, then the query
 * as a fallback. A value that is not a positive integer is ignored rather than coerced.
 */
function readSessionId(raw: string): number | undefined {
  const fromPath = Number(raw.split(/[?#]/)[0].replace(/^.*\//, ""));
  if (Number.isFinite(fromPath) && fromPath > 0) return fromPath;

  const at = raw.indexOf("?");
  const found = at >= 0 ? new URLSearchParams(raw.slice(at + 1)).get("brainChatId") : null;
  const id = Number(found);
  return found !== null && Number.isFinite(id) && id > 0 ? id : undefined;
}

/** A tab label for the conversation, falling back to the agent's own name. */
function titleFromResource(resource: vscode.Uri): string {
  return new URLSearchParams(resource.query.replace(/^\?/, "")).get("title") ?? "BuilderForce";
}

/**
 * Restore a reopened session's turns, read through the SAME persistence the chat handler
 * writes to — the host's local store, where the session's id is a LOCAL view key (PRD 36).
 * Reading the server by that id returned whichever server chat shared the number. Rows
 * become real
 * `ChatRequestTurn` / `ChatResponseTurn` instances so the workbench renders them natively
 * — and each assistant turn carries `result.metadata.brainChatId`, which is how the shared
 * handler resumes the conversation on the next message instead of forking a new one.
 *
 * Degrades to [] on any failure: a tab that cannot load its history must still open.
 */
async function sessionHistory(ctx: vscode.ExtensionContext, resource: vscode.Uri) {
  const chatId = chatIdFromResource(resource);
  if (chatId === undefined) return [] as unknown[];

  let rows;
  try {
    rows = await localBrainApplication(ctx).persistence.getMessages(chatId);
  } catch (e) {
    console.error("[BuilderForce] chat-session history read failed:", e);
    return [] as unknown[];
  }

  // NOTE ON CONSTRUCTION: `ChatRequestTurn`/`ChatResponseTurn` are marked `@hidden` in
  // vscode.d.ts (private ctor) because VS Code normally builds them itself — but the
  // ext host DISPATCHES on `instanceof` (`history.map(b => b instanceof oa ?
  // this.convertRequestTurn(b) : this.convertResponseTurn(b, u))`), so plain object
  // literals would be silently misrouted as response turns. The runtime classes are
  // ordinary public constructors; these are their real signatures, read off that
  // dispatch site, reached through `any` because the .d.ts hides them.
  // VERIFIED arity (extensionHostProcess.js): the runtime classes are
  //   ChatRequestTurn:  constructor(t,e,n,o,i,s,a) = (prompt, command, references,
  //                     participant, toolReferences, editedFileEvents, id)   — 7 args
  //   ChatResponseTurn: constructor(t,e,n,o)      = (response, result, participant, command)
  // Do not add an 8th: it lands in `modelId` and silently corrupts the turn.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Turn = vscode as any;

  const turns: unknown[] = [];
  rows.forEach((row, index) => {
    if (row.role === "user") {
      turns.push(
        new Turn.ChatRequestTurn(
          row.content,
          undefined,
          [],
          PARTICIPANT_ID,
          [],
          undefined,
          `bf-${chatId}-${row.seq ?? index}`,
        ),
      );
      return;
    }
    if (row.role !== "assistant") return;
    // `result.metadata.brainChatId` is how the shared handler resumes this conversation on
    // the next message instead of forking a new chat — so a restored session keeps its identity.
    turns.push(
      new Turn.ChatResponseTurn(
        [new vscode.MarkdownString(row.content)],
        { metadata: { brainChatId: chatId } },
        PARTICIPANT_ID,
      ),
    );
  });
  return turns;
}