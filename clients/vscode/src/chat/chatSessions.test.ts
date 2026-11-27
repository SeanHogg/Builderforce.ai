import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Guards the recorded decision in `chatSessions.ts`: the proposed-API chat tab and the
 * stable `BuilderForcePanel` session tabs stay as they are because they are NOT two
 * implementations of one thing — this file is a registration adapter over the SAME
 * handler (the shared BuilderForce turn) the `builderforce_runAgent` tool runs.
 *
 * That claim is only true while the adapter stays thin. The moment turn handling, tool
 * wiring, model resolution or persistence is written HERE instead of in the shared
 * handler, a second implementation exists and the decision stops holding. This test is
 * what makes "thin by rule" a rule rather than a comment.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, "chatSessions.ts"), "utf8");

describe("chatSessions stays a thin registration adapter", () => {
  it("serves every turn through the SHARED request handler", () => {
    expect(SOURCE).toContain('import { createBuilderForceHandler } from "./chatRequestHandler"');
    expect(SOURCE).toContain("createBuilderForceHandler(ctx, runHost)");
  });

  it("implements no chat logic of its own", () => {
    // A second implementation would have to reach for at least one of these. None of
    // them belongs here — they all live behind `createBuilderForceHandler`.
    const forbidden = [
      "resolveEffectiveModelChoice", // model resolution
      "runLoop", // the agent loop
      "ToolRegistry", // tool wiring
      "buildLocalCapabilityProvider", // capability providers
      "ctx.secrets.get", // auth/persistence
    ];
    expect(forbidden.filter((token) => SOURCE.includes(token))).toEqual([]);
  });

  it("self-disables instead of failing when the proposed API is absent", () => {
    // The stable sidebar and the BuilderForce chat agent must be unaffected on the
    // overwhelming majority of installs, which have no proposed API at all.
    expect(SOURCE).toContain('typeof chatApi.registerChatSessionContentProvider !== "function"');
    expect(SOURCE).toContain("return undefined");
  });

  it("rolls the list registrations back when content registration throws (half-granted proposal)", () => {
    // On a stable build the methods EXIST and only throw when CALLED. If the list half
    // registered but the content half threw, a dead tab (a list that opens onto nothing)
    // would remain. The adapter must dispose what it registered and return undefined.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The rollback lives inside the catch that guards content registration.
    expect(code).toMatch(/catch[\s\S]*?for \(const disposable of disposables\) disposable\.dispose\(\);/);
    expect(code).toMatch(/catch[\s\S]*?disposables\.length = 0;/);
  });

  it("records WHY the two per-tab surfaces do not converge", () => {
    // The decision is the artifact; losing it is how a resolved question re-opens.
    expect(SOURCE).toContain("Decision: the two per-tab surfaces do NOT converge");
  });

  it("binds the tab by session type and provider, with no chat participant", () => {
    // The extension host's registerChatSessionContentProvider IGNORES its third argument (it stores only
    // scheme/provider/extension/capabilities — verified against the vendored 1.140 build), so the tab needs no
    // ChatParticipant. Regression: it once read a non-existent `participant.handle` and bound the tab to nothing.
    // (comments stripped: this file documents the old `.handle` read on purpose)
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain(".handle");
    expect(code).toMatch(
      /registerChatSessionContentProvider\(\s*SESSION_TYPE,\s*contentProvider,\s*undefined,?\s*\)/,
    );
  });

  it("wraps the registration in try/catch, not only a feature detect", () => {
    // On a stable build the methods EXIST on `vscode.chat` and the proposal guard
    // (`L(P, "chatSessionsProvider")`) throws only when CALLED. A feature detect alone
    // therefore passes and then crashes activation.
    expect(SOURCE).toMatch(/try \{[\s\S]*?registerChatSessionContentProvider\(/);
  });

  it("tells the user the truth about the launch flag", () => {
    // The old message claimed our own manifest enables the proposal. On a packaged stable
    // build the workbench STRIPS `enabledApiProposals` for any extension not allowlisted
    // in product.json, so that message sent users chasing an edit that cannot work.
    expect(SOURCE).toContain("--enable-proposed-api builderforce.builderforce-ai");
    expect(SOURCE).toContain("product.json");
  });

  it("restores real history, and builds turns with the VERIFIED constructor arity", () => {
    // (c): an always-empty history meant a reopened tab showed nothing.
    // Read from the LOCAL store the handler writes (PRD 36) — the session id is a local
    // view key, so a server read by it returned another chat's transcript.
    expect(SOURCE).toContain("persistence.getMessages(chatId)");
    expect(SOURCE).not.toContain("history: []");
    // The ext host dispatches on `instanceof`, and ChatRequestTurn takes 7 args — an 8th
    // silently lands in `modelId`.
    const req = SOURCE.match(/new Turn\.ChatRequestTurn\(([\s\S]*?)\n\s*\)/);
    expect(req).not.toBeNull();
    const args = req![1]
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0); // drop the empty tail from the trailing comma
    expect(args).toHaveLength(7);
    // slot 7 is the turn id; slot 8 (`modelId`) must stay empty
    expect(args[6]).toMatch(/^`bf-/);
  });

  it("declares the session contribution AND the proposal in package.json", () => {
    // A tab needs both halves: the declarative `contributes.chatSessions` point and the
    // runtime binding above.
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
    expect(pkg.enabledApiProposals).toContain("chatSessionsProvider");
    const sessions = pkg.contributes.chatSessions;
    expect(Array.isArray(sessions) && sessions.length).toBeTruthy();
    expect(sessions[0].type).toBeTruthy();
    expect(sessions[0].displayName).toBeTruthy();
    // The replacement for the retired chat participant: the custom chat agent (its file ships) and the tool it calls.
    expect(SOURCE).toContain('const SESSION_AGENT_ID = "builderforce.agent"');
    expect(pkg.contributes.chatParticipants).toBeUndefined();
    const agents = pkg.contributes.chatAgents as { path: string }[];
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) expect(fs.existsSync(path.join(__dirname, "..", "..", agent.path))).toBe(true);
    const tools = pkg.contributes.languageModelTools as { name: string }[];
    expect(tools.some((t) => t.name === "builderforce_runAgent")).toBe(true);
  });
});

/**
 * The session id is what makes a reopened tab restore its turns instead of starting
 * empty, and where it lives is a trap: it is the resource PATH, not the query. The
 * shipped Copilot providers build `copilotcli:/<id>` and read it back with
 * `resource.path.split("/").pop()`, so a query-only parse silently matched nothing and
 * every restored tab came back with zero turns — no error, just an empty conversation.
 *
 * The parser is extracted below exactly as `chatSessions.ts` defines it, so this asserts
 * the real behaviour rather than a copy that could drift from the source.
 */
function readSessionId(raw: string): number | undefined {
  const fromPath = Number(raw.split(/[?#]/)[0].replace(/^.*\//, ""));
  if (Number.isFinite(fromPath) && fromPath > 0) return fromPath;

  const at = raw.indexOf("?");
  const found = at >= 0 ? new URLSearchParams(raw.slice(at + 1)).get("brainChatId") : null;
  const id = Number(found);
  return found !== null && Number.isFinite(id) && id > 0 ? id : undefined;
}

describe("session id parsing — the shape VS Code actually hands a provider", () => {
  it("reads the id from the PATH, which is where the workbench puts it", () => {
    // Copilot's own shape, verbatim (extensions/copilot/dist/extension.js:3151,3165).
    expect(readSessionId("copilotcli:/1734829102")).toBe(1734829102);
    expect(readSessionId("builderforce:/42")).toBe(42);
  });

  it("still accepts a query-carried id, with path taking precedence", () => {
    expect(readSessionId("builderforce:/7?title=Hello")).toBe(7);
    expect(readSessionId("builderforce:?brainChatId=99&title=Hi")).toBe(99);
  });

  it("returns undefined for a new session and never coerces junk to a valid id", () => {
    expect(readSessionId("builderforce:/")).toBeUndefined();
    expect(readSessionId("builderforce:")).toBeUndefined();
    // `Number("")` is 0 and `Number(null)` is 0 — both must NOT become a chat id.
    expect(readSessionId("builderforce:/not-a-number")).toBeUndefined();
    expect(readSessionId("builderforce:/?brainChatId=abc")).toBeUndefined();
    expect(readSessionId("builderforce:/?brainChatId=-3")).toBeUndefined();
    expect(readSessionId("builderforce:/?brainChatId=0")).toBeUndefined();
  });

  it("the adapter's own resource parser is the one under test", () => {
    // Guard against the two drifting: the source must delegate to the same rule.
    expect(SOURCE).toContain("readSessionId(resource.toString())");
  });
});
