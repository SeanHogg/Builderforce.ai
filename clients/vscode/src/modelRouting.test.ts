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
      createLocalStream: ["modelRouting.ts", "localModels.ts"],
      completeLocal: ["modelRouting.ts", "localModels.ts"],
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
    const host = stripComments(fs.readFileSync(path.join(SRC, "brainWebview.ts"), "utf8"));
    expect(host).toContain("resolveModelRoute");
    expect(host).not.toContain("resolveEffectiveModelChoice");
    // …and the proxy it exposes must be fenced by the shared rule, not a local copy.
    expect(host).toContain("resolveLocalChatEndpoint");
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
    const host = stripComments(fs.readFileSync(path.join(SRC, "brainWebview.ts"), "utf8"));
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
  const app = fs.readFileSync(path.join(SRC, "..", "webview", "src", "App.tsx"), "utf8");

  it("builds the gateway transport once and hands it to the tool catalogue", () => {
    expect(app).toContain("gatewayTransport");
    expect(stripComments(app)).toMatch(/<PlatformTools transport=\{gatewayTransport\}/);
  });

  it("keeps the run's transport free to be the local one", () => {
    // The whole point: the completion goes to the machine, the catalogue does not.
    expect(stripComments(app)).toMatch(/transport: init\.localRoute/);
  });
});
