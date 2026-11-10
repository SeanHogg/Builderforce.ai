/**
 * factIndex.restoreCandidates.test.ts — a restored candidate mount is re-decided against the RESTORED router set
 * (PRD 41 §C5.1): the store holds decided facts, the candidate sidecar holds the raw candidates (at their content hash),
 * and `restore()` puts them back and re-decides — so a target that lost its routes before the restore reads as
 * middleware, with no re-extraction.
 */

import { describe, expect, it } from "vitest";
import { memoryCandidateRows } from "@builderforce/agent-tools/node-knowledge-store";
import { extractFileFacts } from "@builderforce/agent-tools/node-file-facts";
import { loadFactGraph, memoryFactStore, saveFactGraph, updateFactGraph } from "@seanhogg/builderforce-memory/knowledge";
import { FactGraphStore } from "./factGraphStore";
import { FactIndex } from "./factIndex";
import { nodeContentHash } from "./nodeSha256";

const enc = new TextEncoder();
const APP = "const express = require('express');\nconst users = require('./users');\nconst app = express();\napp.use('/users', users);\n";
const ROUTER = "const r = require('express').Router();\nr.get('/:id', (q, s) => s.json(q.params));\nmodule.exports = r;\n";
const MIDDLEWARE = "module.exports = (req, res, next) => next();\n";

describe("FactIndex.restore re-decides candidate mounts", () => {
  it("a target that lost its routes before the restore: after restore the mount reads as middleware (no re-extraction)", async () => {
    const port = memoryFactStore();
    const candidates = memoryCandidateRows();
    const tree = new Map([["src/app.js", APP], ["src/users.js", ROUTER]]);
    const a = new FactIndex({ facts: (p) => extractFileFacts(p, tree.get(p) ?? ""), store: new FactGraphStore(port, () => undefined), candidates });
    await a.sync([...tree].map(([path, t]) => ({ path, hash: nodeContentHash(enc.encode(t)) })));
    await a.flush();
    const appOf = (graph: { manifest: ReadonlyMap<string, { factsHash: string }>; objects: ReadonlyMap<string, unknown> }) =>
      graph.objects.get(graph.manifest.get("src/app.js")!.factsHash) as { mounts?: unknown[]; uses?: unknown[] };
    expect(appOf(a.current).mounts).toHaveLength(1);

    // The store moves under the decision: users.js is middleware now, app.js's saved facts still say "mount".
    const loaded = await loadFactGraph(port);
    const users = (await extractFileFacts("src/users.js", MIDDLEWARE))!;
    await saveFactGraph(port, updateFactGraph(loaded.graph, [{ path: "src/users.js", facts: users }], []).graph, loaded);

    const extracted: string[] = [];
    const b = new FactIndex({ facts: (p) => { extracted.push(p); return extractFileFacts(p, tree.get(p) ?? ""); }, store: new FactGraphStore(port, () => undefined), candidates });
    expect(await b.restore()).toBe(true);
    expect(extracted).toEqual([]);
    expect(appOf(b.current).mounts).toEqual([]);
    expect(appOf(b.current).uses).toEqual([{ path: "/users", guards: ["users"], order: 0, router: "app" }]);
  });

  it("a candidate row of another content hash is stale: the stored decision stands", async () => {
    const port = memoryFactStore();
    const candidates = memoryCandidateRows();
    const tree = new Map([["src/app.js", APP], ["src/users.js", ROUTER]]);
    const a = new FactIndex({ facts: (p) => extractFileFacts(p, tree.get(p) ?? ""), store: new FactGraphStore(port, () => undefined), candidates });
    await a.sync([...tree].map(([path, t]) => ({ path, hash: nodeContentHash(enc.encode(t)) })));
    await a.flush();
    const rows = await candidates.load();
    await candidates.write([{ ...rows.get("src/app.js")!, hash: "another" }], []);
    const loaded = await loadFactGraph(port);
    await saveFactGraph(port, updateFactGraph(loaded.graph, [{ path: "src/users.js", facts: (await extractFileFacts("src/users.js", MIDDLEWARE))! }], []).graph, loaded);
    const b = new FactIndex({ facts: async () => undefined, store: new FactGraphStore(port, () => undefined), candidates });
    await b.restore();
    const app = b.current.objects.get(b.current.manifest.get("src/app.js")!.factsHash)!;
    expect(app.mounts?.map((m) => m.target)).toEqual(["./users"]);
  });
});
