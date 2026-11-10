/**
 * node-file-facts.test.ts — RAW FileFacts v3 extraction (PRD 41 §B3, §C5.1, §8 Part B): golden facts per supported
 * language (TS, JS, Python), the router model (`uses`, `mounts`, registration `order`, composed by memory's
 * `effectiveGuards`), determinism (same bytes → same facts and tag), the autocrlf fixture, the cap (measured on the
 * EOL-normalized text; past it the facts are CAPPED, never absent), an unloadable grammar (thrown, never "no facts"), the
 * fact-kind split, and the grammar versions held to the installed packages.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJson, effectiveGuards, factKindHashes, type FileFacts } from "@seanhogg/builderforce-memory/knowledge";
import {
  extractFileFacts, FACTS_GRAMMAR_UNAVAILABLE, fileFactsStamp, hasFileFacts, MAX_FACTS_PARSE_BYTES, TREE_SITTER_WASMS_VERSION, WEB_TREE_SITTER_VERSION,
} from "./node-file-facts.js";
import { isCappedFacts } from "./knowledge/facts/fileFactsOf.js";
import { bare } from "./knowledge/facts/capabilities.js";
import { JS_EXPRESS, JS_TEST, PY_APP, PY_TEST, PY_UNITTEST, TS_MOUNTS, TS_ROUTES, TS_SERVICE } from "./knowledge/facts/factsFixtures.test-util.js";

const facts = async (path: string, text: string): Promise<FileFacts> => {
  const f = await extractFileFacts(path, text);
  if (!f) throw new Error(`no facts for ${path}`);
  return f;
};
const names = <T extends { name: string }>(xs: readonly T[]) => xs.map((x) => x.name);
const crlf = (t: string) => t.replace(/\n/g, "\r\n");
const guardsByKey = (f: FileFacts) => Object.fromEntries(effectiveGuards(f, []).entryPoints.map((e) => [e.key, e.guards]));

describe("FileFacts golden: TypeScript routes and routers", () => {
  it("routes: inline guards on the entry point, the router's `use` as a UseFact, ONE registration order, raw chain specifiers", async () => {
    const f = await facts("src/routes.ts", TS_ROUTES);
    expect(f.extractor).toBe(`tree-sitter@3.1/typescript=${TREE_SITTER_WASMS_VERSION}+${WEB_TREE_SITTER_VERSION}/eol-lf@1`);
    expect(f.uses).toEqual([{ path: "", guards: ["audit"], order: 0, router: "app" }]);
    expect(f.entryPoints).toEqual([
      { kind: "http-route", key: "GET /health", symbol: "<inline>", guards: [], inputs: [], chain: [], order: 2, router: "app" },
      { kind: "http-route", key: "POST /api/projects/:id", symbol: "<inline>", guards: ["requireAuth", "requireRole"], inputs: ["c.req.json"], chain: ["import:./auth"], order: 1, router: "app" },
    ]);
    // Effective guards compose the `use` (registered first) onto both routes.
    expect(guardsByKey(f)).toEqual({ "GET /health": ["audit"], "POST /api/projects/:id": ["audit", "requireAuth", "requireRole"] });
    expect(f.imports.map((i) => [i.specifier, i.names, i.resolved, i.typeOnly])).toEqual([
      ["./auth", ["requireAuth", "requireRole"], undefined, undefined],
      ["./types", ["Ctx"], undefined, true],
      ["hono", ["Hono"], undefined, undefined],
    ]);
  });

  it("mounts: a local router mounted under a prefix, an imported one by its specifier; a path-scoped use guards only later routes", async () => {
    const f = await facts("src/app.ts", TS_MOUNTS);
    expect(f.mounts).toEqual([
      { prefix: "/api", target: "api", order: 3, router: "app" },
      { prefix: "/admin", target: "./admin", order: 4, router: "app" },
    ]);
    expect(f.uses).toEqual([{ path: "/secure/*", guards: ["requireAuth"], order: 1, router: "api" }]);
    const effective = effectiveGuards(f, []);
    expect(effective.entryPoints.map((e) => [e.key, e.guards])).toEqual([["GET /api/early", []], ["GET /api/secure/data", ["requireAuth"]]]);
    expect(effective.unresolved).toBe(1); // './admin' is the host's to resolve
  });

  it("Express CommonJS: require bindings, a `use` between routes, `module.exports` as the default export", async () => {
    const f = await facts("src/router.js", JS_EXPRESS);
    expect(guardsByKey(f)).toEqual({ "GET /closed": ["requireAuth"], "GET /open": [] });
    expect(f.exports.map((e) => [e.name, e.kind])).toEqual([["default", "const"]]);
    expect(f.entryPoints.find((e) => e.key === "GET /closed")?.inputs).toEqual(["req.body"]);
  });
});

describe("FileFacts golden: TypeScript service", () => {
  it("symbols, exports, calls in loops (body AND condition), class-field arrows, complexity, capabilities", async () => {
    const f = await facts("src/service.ts", TS_SERVICE);
    expect(names(f.symbols)).toEqual(["Id", "Row", "Store", "Store.digest", "Store.hidden", "Store.onEvent", "load"]);
    expect(f.exports.map((e) => [e.name, e.kind, e.from])).toEqual([
      ["Id", "type", undefined], ["Row", "interface", undefined], ["Store", "class", undefined], ["helper", "re-export", "./helper"], ["load", "function", undefined],
    ]);
    const call = (callee: string) => f.calls.find((c) => c.callee === callee);
    expect(call("db.get")).toMatchObject({ enclosing: "load", awaited: true, inLoop: true });
    expect(call("queue.next")).toMatchObject({ enclosing: "load", awaited: true, inLoop: true }); // a while condition runs per iteration
    expect(call("fetch")).toMatchObject({ enclosing: "load", inLoop: true });
    expect(call("Promise.all")?.inLoop).toBeUndefined();
    expect(call("db.put")).toMatchObject({ enclosing: "Store.onEvent", awaited: true });
    expect(f.complexity.find((c) => c.symbol === "load")?.cyclomatic).toBe(5);
    expect(f.capabilityImports.map((c) => `${c.capability}:${c.symbol ?? c.module}`)).toEqual([
      "crypto:createHash", "env-read:REGION", "fs-write:writeFileSync", "network-client:fetch", "secret-read:API_TOKEN", "secret-read:DB_PASSWORD",
    ]);
  });

  it("a private member never reaches the class's signature; a public one does", async () => {
    const sig = async (text: string) => (await facts("src/service.ts", text)).exports.find((e) => e.name === "Store")!.signatureHash;
    const base = await sig(TS_SERVICE);
    expect(await sig(TS_SERVICE.replace("private hidden(): void {}", "private hidden(n: number): void {}"))).toBe(base);
    expect(await sig(TS_SERVICE.replace("digest(text: string): string", "digest(text: string, salt: string): string"))).not.toBe(base);
  });

  it("a scoped package is one package", () => {
    expect(bare("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(bare("node:fs/promises")).toBe("fs");
  });
});

describe("FileFacts golden: JavaScript test file", () => {
  it("test facts: titles, assertions, matcher strength (a negated matcher is never exact), modifiers, timeouts, snapshots", async () => {
    const t = (await facts("src/math.test.js", JS_TEST)).testFacts!;
    expect(t.framework).toBe("vitest");
    expect(t.snapshotFiles).toEqual(["src/__snapshots__/math.test.js.snap"]);
    expect(t.tests.map((x) => [x.name, x.assertions, x.modifier, x.timeoutMs])).toEqual([
      ["math › adds", 3, undefined, undefined], ["math › later", 0, "todo", undefined], ["math › skipped", 1, "skip", 5000], ["math › snaps", 1, undefined, undefined],
    ]);
    expect(t.tests[0]!.matchers).toEqual([
      { matcher: "not.toBe", strength: "partial", count: 1 }, { matcher: "toBeTruthy", strength: "presence", count: 1 }, { matcher: "toEqual", strength: "exact", count: 1 },
    ]);
  });
});

describe("FileFacts golden: Python", () => {
  it("app: raw imports, public exports, decorator routes with guards and the guards' module as the chain", async () => {
    const f = await facts("app/app.py", PY_APP);
    expect(f.imports.map((i) => [i.specifier, i.names, i.resolved])).toEqual([
      [".auth", ["login_required"], undefined], [".models", ["Item", "User"], undefined], ["flask", ["Flask", "request"], undefined], ["os", ["*"], undefined], ["subprocess", ["*"], undefined],
    ]);
    expect(names(f.exports)).toEqual(["Repo", "create_item"]);
    expect(f.entryPoints.map((e) => [e.key, e.guards, e.chain, e.inputs])).toEqual([
      ["POST /items", ["login_required"], ["import:.auth"], ["request.json"]], ["PUT /items", ["login_required"], ["import:.auth"], ["request.json"]],
    ]);
    expect(f.calls.find((c) => c.callee === "db.save")).toMatchObject({ enclosing: "create_item", inLoop: true });
  });

  it("pytest and unittest: Test classes, TestCase subclasses of any name, skip decorators", async () => {
    expect((await facts("app/test_repo.py", PY_TEST)).testFacts!.tests.map((x) => [x.name, x.assertions, x.modifier]))
      .toEqual([["TestRepo › test_find", 2, undefined], ["test_skipped", 1, "skip"]]);
    const u = (await facts("app/checks.py", PY_UNITTEST)).testFacts!;
    expect([u.framework, u.tests.map((x) => [x.name, x.assertions])]).toEqual(["unittest", [["RepoChecks › test_one", 1]]]);
  });
});

describe("FileFacts determinism, autocrlf, cap and failures", () => {
  it("the same bytes give the same facts and the same tag; a given content hash is used as is", async () => {
    for (const [path, text] of [["src/routes.ts", TS_ROUTES], ["src/app.ts", TS_MOUNTS], ["src/service.ts", TS_SERVICE], ["app/app.py", PY_APP]] as const) {
      const a = await facts(path, text);
      expect(canonicalJson(await extractFileFacts(path, new TextEncoder().encode(text)))).toBe(canonicalJson(a));
      expect((await extractFileFacts(path, text, { contentHash: "given" }))?.contentHash).toBe("given");
    }
  });

  it("autocrlf: a CRLF checkout and an LF checkout give byte-identical facts (content hash included)", async () => {
    for (const [path, text] of [["src/service.ts", TS_SERVICE], ["src/math.test.js", JS_TEST], ["app/test_repo.py", PY_TEST], ["src/router.js", JS_EXPRESS]] as const) {
      expect(canonicalJson(await facts(path, crlf(text)))).toBe(canonicalJson(await facts(path, text)));
    }
  });

  it("the cap is measured on the EOL-normalized text; past it the facts are CAPPED (present, empty, never comparable)", async () => {
    const line = "export const a = 1;\n";
    const under = line.repeat(Math.floor((MAX_FACTS_PARSE_BYTES - 100) / line.length));
    // Its CRLF form is larger than the cap in raw bytes, but not once normalized: it is parsed, like the LF form.
    expect(new TextEncoder().encode(crlf(under)).byteLength).toBeGreaterThan(MAX_FACTS_PARSE_BYTES);
    expect(isCappedFacts(await facts("src/big.ts", crlf(under)))).toBe(false);
    const capped = await facts("src/big.ts", line.repeat(Math.ceil((MAX_FACTS_PARSE_BYTES + 100) / line.length)));
    expect(isCappedFacts(capped)).toBe(true);
    expect([capped.exports, capped.entryPoints]).toEqual([[], []]);
  }, 60_000); // two ~400 KB files: a parse and a pure-TS content hash each

  it("a grammar that cannot load throws facts_grammar_unavailable (transient), never 'no facts'", async () => {
    const empty = mkdtempSync(join(tmpdir(), "no-grammars-"));
    try {
      await expect(extractFileFacts("src/a.ts", "export const a = 1;\n", { wasmDir: empty })).rejects.toThrow(FACTS_GRAMMAR_UNAVAILABLE);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("a body-only edit moves the body hash only; a comment edit moves only content; a new `use` moves structure", async () => {
    const base = factKindHashes(await facts("src/service.ts", TS_SERVICE));
    const body = factKindHashes(await facts("src/service.ts", TS_SERVICE.replace("out.push(await db.get(id));", "out.push(await db.find(id));")));
    expect([body.structure === base.structure, body.body === base.body, body.content === base.content]).toEqual([true, false, false]);
    const comment = factKindHashes(await facts("src/service.ts", `// note\n${TS_SERVICE}`));
    expect([comment.structure === base.structure, comment.body === base.body]).toEqual([true, true]);
    const routes = factKindHashes(await facts("src/routes.ts", TS_ROUTES));
    expect(factKindHashes(await facts("src/routes.ts", TS_ROUTES.replace("app.use(audit);", "app.use(audit, rateLimit);"))).structure).not.toBe(routes.structure);
  });

  it("files without a fact grammar, and binary bytes, give no facts", async () => {
    expect(hasFileFacts("README.md")).toBe(false);
    expect(await extractFileFacts("README.md", "# hi")).toBeUndefined();
    expect(await extractFileFacts("src/a.ts", new Uint8Array([0, 1, 2]))).toBeUndefined();
  });

  it("the stamp's grammar versions are the installed packages'", () => {
    const req = createRequire(import.meta.url);
    expect(TREE_SITTER_WASMS_VERSION).toBe((req("tree-sitter-wasms/package.json") as { version: string }).version);
    expect(WEB_TREE_SITTER_VERSION).toBe((req("web-tree-sitter/package.json") as { version: string }).version);
    expect(Object.keys(fileFactsStamp().grammars ?? {})).toEqual(["javascript", "python", "tsx", "typescript"]);
  });
});
