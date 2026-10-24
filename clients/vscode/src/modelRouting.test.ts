import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Guards the recorded decision in `modelRouting.ts`: WHERE a turn runs is decided in ONE
 * place, and every AI surface asks rather than derives.
 *
 * This is a source-level test because the thing being protected is a structural rule, not
 * a return value — and because the rule has already been broken once. Before it existed,
 * the chat participant honoured the picked model while the codebase scanner read
 * `builderforce.defaultModel` straight from configuration, so pinning an on-device model
 * left the scanner summarizing through the gateway under a different model. Nothing
 * failed; the two surfaces just quietly disagreed. A unit test on either one would have
 * passed.
 *
 * So the assertions below are about WHO IS ALLOWED to know things:
 *   - only `modelRouting` picks a transport;
 *   - only `modelState` reads the default-model setting;
 *   - the gateway client stays ignorant of on-device models entirely.
 */

const SRC = __dirname;

/**
 * Strip comments before matching. These modules explain themselves by NAMING their
 * counterpart ("the local twin of `createNativeStream`"), and prose that describes the
 * seam is exactly what should be encouraged — failing a file for documenting the rule it
 * follows would train the wrong reflex. Only real code is evidence of a second router.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every non-test source file, comments removed. */
function sourceFiles(): Array<{ name: string; text: string }> {
  return fs
    .readdirSync(SRC)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((name) => ({ name, text: stripComments(fs.readFileSync(path.join(SRC, name), "utf8")) }));
}

describe("model routing is centralized", () => {
  it("has the seam it claims to have", () => {
    // Guards the guard: a rename that emptied this file would make every case vacuous.
    const routing = fs.readFileSync(path.join(SRC, "modelRouting.ts"), "utf8");
    for (const symbol of ["resolveModelRoute", "routeRequiresSignIn", "routeStream", "routeComplete"]) {
      expect(routing).toContain(`export ${symbol.startsWith("route") && symbol !== "routeComplete" ? "function" : ""}`.trim());
      expect(routing).toContain(symbol);
    }
  });

  it("lets ONLY modelRouting choose a transport", () => {
    // `createNativeStream` (gateway) and `createLocalStream`/`completeLocal` (on-device)
    // are the two sides of the branch. A second module reaching for either one is a
    // second router, which is how the surfaces diverged before.
    const owners: Record<string, readonly string[]> = {
      createNativeStream: ["modelRouting.ts", "nativeBrainRun.ts"],
      // The local transports are brain-embedded's (shared with the Chrome extension);
      // in the editor only the seam reaches for them. `completeLocal` also matches
      // `completeLocalFirst` — local-first is a transport choice too. The streaming side
      // is ONE call, `createHostModelStream` (the routing step every host shares).
      createHostModelStream: ["modelRouting.ts"],
      createLocalStream: [],
      completeLocal: ["modelRouting.ts"],
      createLocalFirstStream: [],
      probeLocalFirstRuntimes: ["modelRouting.ts", "localModels.ts"],
    };
    for (const [symbol, allowed] of Object.entries(owners)) {
      const offenders = sourceFiles()
        .filter(({ name }) => !allowed.includes(name))
        .filter(({ text }) => text.includes(symbol))
        .map(({ name }) => name);
      expect(offenders, `${symbol} should be reached only via modelRouting`).toEqual([]);
    }
  });

  it("keeps the gateway client ignorant of on-device models", () => {
    // The gateway module may read the local SETTINGS (it owns configuration accessors),
    // but it must not parse local refs or dispatch to a runtime — that briefly leaked
    // there and put routing policy inside the transport it was supposed to choose between.
    const gateway = stripComments(fs.readFileSync(path.join(SRC, "gateway.ts"), "utf8"));
    expect(gateway).not.toContain("parseLocalModelRef");
    expect(gateway).not.toContain("completeLocal");
    expect(gateway).not.toContain("localFirstPlan");
  });

  it("decides local-first in the seam, letting any model choice win over it", () => {
    const routing = stripComments(fs.readFileSync(path.join(SRC, "modelRouting.ts"), "utf8"));
    // An explicit pick / Evermind pin / default model / BYO pool names what the user
    // wants; only gateway-auto may be served on this machine first.
    expect(routing).toContain("if (!localFirstApplies(choice)) return choice;");
    // Signed out, a local-first route needs no account (it just has no cloud fallback).
    expect(routing).toContain("route.localFirst === undefined");
    // Both completion surfaces honour it.
    expect(routing).toContain("createHostModelStream(");
    expect(routing).toContain("completeLocalFirst(");
  });

  it("reads the default-model setting in exactly one place", () => {
    const readers = sourceFiles()
      .filter(({ text }) => text.includes('"defaultModel"'))
      .map(({ name }) => name);
    expect(readers).toEqual(["modelState.ts"]);
  });

  it("routes the Brain webview through the seam too", () => {
    // The panel is the third AI surface and the one that could most easily grow its own
    // answer, because it runs in a webview and receives its config by message. It must
    // be HANDED the route (`localRoute` in `init`), never resolve one.
    // Every host of the workspace surface (editor tab, chat view) is handed `init` by
    // `workspaceInit.ts`, and every one proxies local fetches through `localFetchProxy.ts`.
    const host = stripComments(fs.readFileSync(path.join(SRC, "workspaceInit.ts"), "utf8"));
    expect(host).toContain("resolveModelRoute");
    expect(host).not.toContain("resolveEffectiveModelChoice");
    // …and the proxy it exposes must be fenced by the shared rule, not a local copy.
    const proxy = stripComments(fs.readFileSync(path.join(SRC, "localFetchProxy.ts"), "utf8"));
    expect(proxy).toContain("resolveLocalChatEndpoint");
  });

  it("routes every completion surface through the seam", () => {
    // The scanner is the surface that silently stayed on the gateway. It must take a
    // route, not a model id, so it cannot resolve one of its own.
    const scan = fs.readFileSync(path.join(SRC, "codebaseScan.ts"), "utf8");
    expect(scan).toContain("routeComplete");
    expect(scan).toContain("route: ModelRoute");
    expect(scan).not.toContain('from "./gateway"');
  });
});

/**
 * The permission mode is the SECOND product question two surfaces answered separately.
 * Same guard, same reason: the participant read the setting per turn while the panel
 * defaulted its own switch off and never looked, so changing `permissionMode` moved one
 * and not the other.
 */
describe("the permission mode is decided in one place", () => {
  it("reads the permissionMode setting only in its own module", () => {
    const readers = sourceFiles()
      .filter(({ text }) => text.includes('"permissionMode"'))
      .map(({ name }) => name);
    expect(readers).toEqual(["permissionMode.ts"]);
  });

  it("hands the panel the resolved value instead of letting it derive one", () => {
    const host = stripComments(fs.readFileSync(path.join(SRC, "workspaceInit.ts"), "utf8"));
    expect(host).toContain("autoApproveDefault");
  });

  it("re-pushes it to an open panel when the setting changes", () => {
    // Without this the two surfaces disagree for as long as the panel stays open —
    // the same failure, merely delayed.
    const ext = stripComments(fs.readFileSync(path.join(SRC, "extension.ts"), "utf8"));
    expect(ext).toContain("onDidChangeConfiguration");
    expect(ext).toContain("PERMISSION_MODE_SETTING");
  });
});

/**
 * The transport answers TWO questions — where the model streams, and where the platform
 * lives — and an on-device route splits them. Conflating them cost the panel its entire
 * tool catalogue the moment a local model was pinned: projects, tasks and OKRs were
 * fetched from the local runtime, which serves no such route, so the Brain answered
 * "I don't have that data" with zero tool calls in the trace.
 */
describe("the platform stays on the gateway when the model does not", () => {
  // The run now executes in the extension host (brainRunHost.ts); its ports are where
  // the two questions are answered — and they must be answered by DIFFERENT seams.
  const ports = stripComments(fs.readFileSync(path.join(SRC, "brainRunHostPorts.ts"), "utf8"));
  const catalog = stripComments(fs.readFileSync(path.join(SRC, "platformTools.ts"), "utf8"));

  it("fetches the tool catalogue from the gateway, never from the route's endpoint", () => {
    expect(ports).toContain("brainToolCatalog(");
    // The catalogue's base URL is the platform's, resolved without consulting the route.
    expect(catalog).toMatch(/fetch\(`\$\{url\}\/llm\/v1\/mcp\/tools`/);
    expect(catalog).toContain("const url = getBaseUrl();");
    expect(catalog).not.toContain("resolveModelRoute");
  });

  it("keeps the run's transport free to be the local one", () => {
    // The whole point: the completion goes to the machine, the catalogue does not.
    expect(ports).toMatch(/routeStream\(await resolveModelRoute\(secrets, \{ turn: true \}\)/);
  });

  it("starts provisioning a local model only from a turn — never from a panel opening or a scan", () => {
    // `turn: true` is what lets the route call `hostModelProvisioner.ensure()`; the two
    // chat surfaces pass it, the panel init and the workspace scan resolve without it.
    const participant = stripComments(fs.readFileSync(path.join(SRC, "chatParticipant.ts"), "utf8"));
    expect(participant).toContain("resolveModelRoute(ctx.secrets, { turn: true })");
    const init = stripComments(fs.readFileSync(path.join(SRC, "workspaceInit.ts"), "utf8"));
    const extension = stripComments(fs.readFileSync(path.join(SRC, "extension.ts"), "utf8"));
    for (const source of [init, extension]) expect(source).not.toContain("turn: true");
    const routing = stripComments(fs.readFileSync(path.join(SRC, "modelRouting.ts"), "utf8"));
    expect(routing).toContain("if (request.turn && config.enabled && config.localFirst) hostModelProvisioner.ensure();");
  });

  it("never lets a Hybrid fallback be silent — both chat surfaces hear onFallback", () => {
    const routing = stripComments(fs.readFileSync(path.join(SRC, "modelRouting.ts"), "utf8"));
    const participant = stripComments(fs.readFileSync(path.join(SRC, "chatParticipant.ts"), "utf8"));
    const host = stripComments(fs.readFileSync(path.join(SRC, "brainRunHost.ts"), "utf8"));
    // The seam hands the shared step the surface's handler…
    expect(routing).toContain("...(onFallback ? { onFallback } : {})");
    // …the panel's run host passes one that announces the notice to that chat's panel…
    expect(ports).toMatch(/routeStream\(await resolveModelRoute\(secrets, \{ turn: true \}\), await getApiKey\(secrets\), onFallback\)/);
    expect(host).toContain('type: "run.modelFallback"');
    // …and the participant writes the line into its own response.
    expect(participant).toMatch(/routeStream\(modelChoice, key, \(event\) =>/);
    expect(participant).toContain('"Your pick {0} failed; answered with Auto."');
  });
});

/**
 * The INFERENCE MODE rides on the route: Local only never reaches the gateway and never
 * asks for an account, and a turn nothing can serve fails `no_local_model` — the
 * signed-in person whose cloud is unavailable is never shown the sign-in prompt.
 */
describe("the inference mode is decided by the seam", () => {
  const routing = stripComments(fs.readFileSync(path.join(SRC, "modelRouting.ts"), "utf8"));

  it("stamps the mode on every route from the one setting module", () => {
    expect(routing).toContain("inferenceMode: currentInferenceMode()");
    const readers = sourceFiles()
      .filter(({ text }) => text.includes('"inferenceMode"'))
      .map(({ name }) => name);
    expect(readers).toEqual(["inferenceModeSetting.ts"]);
  });

  it("never owes an account, nor builds a cloud stream, on Local only", () => {
    expect(routing).toContain('route.inferenceMode !== "local-only" && route.local === undefined');
    expect(routing).toContain('!localOnly(route) && apiKey && platformPolicy().allows("gateway-inference")');
    expect(routing).toContain("if (localOnly(route)) throw new Error(NO_LOCAL_MODEL);");
  });

  it("tells the shared step the mode and whether the person is signed in", () => {
    expect(routing).toContain('mode: () => route.inferenceMode ?? "hybrid"');
    expect(routing).toContain("signedIn: () => !!apiKey");
    expect(routing).toContain("noModel: localOnly(route) || signedIn ? NO_LOCAL_MODEL : NOT_SIGNED_IN");
  });

  it("Specific model with nothing picked is refused no_specific_model — never quietly run local-first", () => {
    expect(routing).toContain('route.inferenceMode === "specific" && !route.model && !route.local && route.routingMode !== "byo_pool"');
    expect(routing).toContain("if (routeNeedsSpecificModel(route)) throw new Error(NO_SPECIFIC_MODEL);");
    // The scanner's local-first cloud leg names the route's model as it stands.
    expect(routing).not.toContain("localOnly(route) ? undefined : route.model");
  });

  it("on Local only never dispatches or authorizes a runtime that leaves the machine (registry data, not a Kimi branch)", () => {
    expect(routing).toContain('choice.inferenceMode === "local-only" && !localRuntime(pin.provider).onDevice');
    expect(routing.indexOf("!localRuntime(pin.provider).onDevice")).toBeLessThan(routing.indexOf("authorizeLocalEndpoint(pin.provider"));
  });
});
