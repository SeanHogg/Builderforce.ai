/**
 * factIndex.mounts.test.ts — an Express `use('/path', imported)` decided at RESOLUTION by the target's facts (PRD 41
 * §C5.1): the fact index makes it a mount while the imported file is a router module and a middleware `use` otherwise —
 * and when that file stops (or starts) being a router, every file using it is re-decided without being re-extracted.
 */

import { describe, expect, it } from "vitest";
import { extractFileFacts } from "@builderforce/agent-tools/node-file-facts";
import { FactIndex } from "./factIndex";
import { nodeContentHash } from "./nodeSha256";

const enc = new TextEncoder();
const APP = "const express = require('express');\nconst users = require('./users');\nconst app = express();\napp.use('/users', users);\n";
const ROUTER = "const r = require('express').Router();\nr.get('/:id', (q, s) => s.json(q.params));\nmodule.exports = r;\n";
const MIDDLEWARE = "module.exports = (req, res, next) => next();\n";

function setup() {
  const tree = new Map([["src/app.js", APP], ["src/users.js", ROUTER]]);
  const extracted: string[] = [];
  const index = new FactIndex({ facts: (path) => { extracted.push(path); return extractFileFacts(path, tree.get(path) ?? ""); } });
  const hashOf = (p: string) => nodeContentHash(enc.encode(tree.get(p)!));
  const appFacts = () => index.current.objects.get(index.current.manifest.get("src/app.js")!.factsHash)!;
  return { tree, index, extracted, hashOf, appFacts, listing: () => [...tree.keys()].map((path) => ({ path, hash: hashOf(path) })) };
}

describe("FactIndex: Express mounts decided by the target's facts", () => {
  it("a router-module target is a mount", async () => {
    const s = setup();
    await s.index.sync(s.listing());
    expect(s.appFacts().mounts).toEqual([{ prefix: "/users", target: "./users", order: 0, router: "app" }]);
    expect(s.appFacts().uses).toEqual([]);
  });

  it("a target that stops being a router re-decides its users: the mount becomes middleware, app.js not re-extracted", async () => {
    const s = setup();
    await s.index.sync(s.listing());
    s.extracted.length = 0;
    s.tree.set("src/users.js", MIDDLEWARE);
    const u = await s.index.update([{ path: "src/users.js", hash: s.hashOf("src/users.js") }]);
    expect(s.extracted).toEqual(["src/users.js"]);
    expect(u.changedPaths).toContain("src/app.js");
    expect(s.appFacts().mounts).toEqual([]);
    expect(s.appFacts().uses).toEqual([{ path: "/users", guards: ["users"], order: 0, router: "app" }]);
    // And back: a router again, a mount again.
    s.tree.set("src/users.js", ROUTER);
    await s.index.update([{ path: "src/users.js", hash: s.hashOf("src/users.js") }]);
    expect(s.appFacts().mounts?.map((m) => m.target)).toEqual(["./users"]);
  });
});
