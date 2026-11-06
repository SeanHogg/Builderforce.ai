import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTryRunner } from "./knowledgeTryRequest";
import { nodeOpen } from "./knowledgeTryTransport";

let server: http.Server;
let port = 0;
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === "/redirect") { res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" }); res.end(); return; }
    if (req.url === "/big") { res.writeHead(200, { "content-type": "text/plain" }); res.write("x".repeat(1024)); res.write("y".repeat(1024)); res.end("z".repeat(1024)); return; }
    if (req.url === "/hang") { res.writeHead(200); res.write("start"); return; }
    let body = "";
    req.on("data", (c) => { body += String(c); });
    req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ method: req.method, body, cookie: req.headers.cookie ?? null })); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));

const runner = (limits = {}) => createTryRunner({ open: nodeOpen, now: Date.now, confirm: async () => true }, limits);

describe("the Node transport against a real local server", () => {
  it("sends the request with only the allow-listed headers and reads the answer", async () => {
    const r = await runner().run({ method: "POST", url: `http://127.0.0.1:${port}/echo`, headers: { "Content-Type": "application/json", Cookie: "secret=1" }, body: '{"a":1}' }, []);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ method: "POST", body: '{"a":1}', cookie: null });
  });

  it("returns a 3xx as it is and never follows it", async () => {
    hits.length = 0;
    const r = await runner().run({ method: "GET", url: `http://127.0.0.1:${port}/redirect` }, []);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("http://127.0.0.1:1/elsewhere");
    expect(hits).toEqual(["GET /redirect"]);
  });

  it("stops at the byte cap while the body streams", async () => {
    const r = await runner({ bodyCap: 1500 }).run({ method: "GET", url: `http://127.0.0.1:${port}/big` }, []);
    expect(r.body).toHaveLength(1500);
    expect(r.truncated).toBe(true);
  });

  it("times out while the server holds the body open", async () => {
    await expect(runner({ timeoutMs: 150 }).run({ method: "GET", url: `http://127.0.0.1:${port}/hang` }, [])).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports a closed port as one generic connect error", async () => {
    await expect(runner().run({ method: "GET", url: "http://127.0.0.1:1/x" }, [])).rejects.toMatchObject({ code: "connect" });
  });
});
