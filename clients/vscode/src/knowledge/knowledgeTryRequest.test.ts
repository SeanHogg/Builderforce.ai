import { describe, expect, it, vi } from "vitest";
import {
  acceptAddress, cleanRequest, createTryRunner, devOriginsFromInspect, devOriginsOf, guardedLookup, userFailureOf, isBlockedAddress, targetOf, TRY_BODY_CAP, TryRequestError,
  type LookupFn, type OpenedResponse, type TryPorts,
} from "./knowledgeTryRequest";

const enc = new TextEncoder();

async function* chunks(parts: Uint8Array[], gate?: Promise<void>): AsyncGenerator<Uint8Array> {
  for (const p of parts) {
    if (gate) await gate;
    yield p;
  }
}

function opened(over: Partial<OpenedResponse> & { parts?: Uint8Array[]; gate?: Promise<void> } = {}): OpenedResponse {
  return {
    status: over.status ?? 200,
    headers: over.headers ?? { "content-type": "application/json" },
    body: over.body ?? chunks(over.parts ?? [enc.encode("{}")], over.gate),
    destroy: over.destroy ?? vi.fn(),
  };
}

function ports(res: () => OpenedResponse | Promise<OpenedResponse> = () => opened(), confirm = true) {
  let t = 1000;
  const p = { open: vi.fn(async () => res()), confirm: vi.fn(async () => confirm), now: () => (t += 25) };
  return p as typeof p & TryPorts;
}

const get = (url: string) => ({ method: "GET", url });
const refused = (code: string) => expect.objectContaining({ code });

describe("targetOf: where a request may go", () => {
  const dev: string[] = [];
  const reject = (url: string, devOrigins: string[] = dev) => expect(() => targetOf(url, devOrigins)).toThrow(TryRequestError);

  it("allows exactly the loopback literals, in any case, with or without a port", () => {
    for (const url of ["http://localhost/x", "http://LOCALHOST:3000/x", "https://127.0.0.1:8787/x", "http://[::1]:3000/x"]) expect(targetOf(url, dev).mode).toBe("loopback");
  });

  it("refuses every look-alike of localhost", () => {
    for (const url of [
      "http://localhost./x", "http://0.0.0.0:3000/x", "http://127.0.0.2/x", "http://[::ffff:127.0.0.1]/x", "http://2130706433/x", "http://0x7f.1/x",
      "http://localhost:3000@evil.com/x", "http://evil.com#@localhost/x", "http://evil.com\\@localhost/x", "http://localhost%2eevil.com/x",
      "http://localhost.evil.com/x", "http://user:pw@localhost/x", "ftp://localhost/x", "file:///etc/passwd", "https://builderforce.ai/api",
    ]) reject(url);
  });

  it("matches a dev origin exactly: scheme, host and port", () => {
    const origins = devOriginsOf(["https://staging.example.com", "http://bücher.dev"]);
    expect(targetOf("https://staging.example.com/x", origins).mode).toBe("dev");
    reject("http://staging.example.com/x", origins);
    reject("https://staging.example.com:444/x", origins);
    expect(origins).toContain("http://xn--bcher-kva.dev");
    expect(targetOf("http://bücher.dev/x", origins).url.hostname).toBe("xn--bcher-kva.dev");
    // A Cyrillic "о" is a different host, not localhost.
    reject("http://localhоst/x", origins);
    reject("http://xn--bcher-kva.dev@staging.example.com/x", origins);
  });

  it("refuses the sensitive ports even on localhost", () => {
    for (const port of [2375, 2376, 6379, 9200, 9300, 11211, 5984, 10250, 10255, 2379, 27017, 5432, 3306]) {
      expect(() => targetOf(`http://localhost:${port}/x`, [])).toThrow(refused("port"));
    }
    expect(targetOf("http://localhost:3000/x", []).port).toBe(3000);
  });
});

describe("devOriginsOf and addresses", () => {
  it("drops link-local, metadata, private, CGNAT and non-http entries", () => {
    const blocked = ["http://169.254.169.254", "http://10.1.2.3", "http://172.16.0.1", "http://172.31.255.1", "http://192.168.1.1", "http://100.64.0.1", "http://[fd00::1]", "http://[fe80::1]", "http://[::ffff:10.0.0.1]", "http://0.0.0.0", "ftp://x.dev", "nope", 3];
    expect(devOriginsOf([...blocked, "https://a.dev/path", "http://172.32.0.1", "http://localhost:4000"])).toEqual(["https://a.dev", "http://172.32.0.1", "http://localhost:4000"]);
    expect(devOriginsOf(undefined)).toEqual([]);
  });
  it("reads only the user-level setting: workspace and folder values are ignored", () => {
    expect(devOriginsFromInspect({ globalValue: ["https://mine.dev"], workspaceValue: ["https://evil.example"], workspaceFolderValue: ["https://evil2.example"] } as never)).toEqual(["https://mine.dev"]);
    expect(devOriginsFromInspect({ workspaceValue: ["https://evil.example"] } as never)).toEqual([]);
    expect(devOriginsFromInspect(undefined)).toEqual([]);
  });
  it("accepts a resolved address by mode", () => {
    expect(acceptAddress("loopback", "127.5.5.5")).toBe(true);
    expect(acceptAddress("loopback", "::1")).toBe(true);
    expect(acceptAddress("loopback", "10.0.0.5")).toBe(false);
    expect(acceptAddress("loopback", "93.184.216.34")).toBe(false);
    expect(acceptAddress("dev", "93.184.216.34")).toBe(true);
    expect(acceptAddress("dev", "169.254.169.254")).toBe(false);
    expect(isBlockedAddress("[fe80::1]")).toBe(true);
  });
});

describe("guardedLookup (DNS rebinding)", () => {
  const inner = (address: string | { address: string; family: number }[]): LookupFn => (_h, _o, cb) => cb(null, address, 4);
  const run = (fn: LookupFn) => new Promise<{ err: Error | null; address: unknown }>((resolve) => fn("localhost", {}, (err, address) => resolve({ err, address })));

  it("refuses a loopback name that resolves to a non-loopback address", async () => {
    expect((await run(guardedLookup(inner("10.0.0.5"), "loopback"))).err?.message).toBe("address refused");
    expect((await run(guardedLookup(inner([{ address: "127.0.0.1", family: 4 }, { address: "93.184.216.34", family: 4 }]), "loopback"))).err).toBeTruthy();
  });
  it("passes a loopback answer through, and a lookup error unchanged", async () => {
    expect(await run(guardedLookup(inner("127.0.0.1"), "loopback"))).toEqual({ err: null, address: "127.0.0.1" });
    const boom: LookupFn = (_h, _o, cb) => cb(new Error("ENOTFOUND"), "", 0);
    expect((await run(guardedLookup(boom, "dev"))).err?.message).toBe("ENOTFOUND");
  });
});

describe("cleanRequest: the shape", () => {
  it("strips every header but content-type and accept, and a GET body", () => {
    const r = cleanRequest({ method: "GET", url: "http://localhost/x", headers: { Cookie: "a=1", Authorization: "Bearer x", Host: "evil", "Content-Type": "application/json", Accept: "*/*" }, body: "{}" });
    expect(r).toEqual({ method: "GET", url: "http://localhost/x", headers: { "content-type": "application/json", accept: "*/*" } });
  });
  it("refuses a bad url, method, body and headers", () => {
    const base = { method: "GET", url: "http://localhost/x" };
    for (const bad of [
      null, "x", [], { ...base, url: 5 }, { ...base, url: "http://localhost/" + "a".repeat(9000) }, { ...base, method: "TRACE" }, { ...base, method: "get" }, { ...base, method: 1 },
      { ...base, body: 5 }, { ...base, body: "x".repeat(256 * 1024 + 1) }, { ...base, headers: [] }, { ...base, headers: "x" }, { ...base, headers: { accept: 1 } },
      { ...base, headers: { accept: "x".repeat(1025) } }, { ...base, headers: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`h${i}`, "v"])) },
    ]) expect(() => cleanRequest(bad)).toThrow(TryRequestError);
  });
});

describe("the runner", () => {
  const dev: string[] = [];

  it("returns status, headers, body and time, and sends only the clean request", async () => {
    const p = ports(() => opened({ status: 201, parts: [enc.encode('{"id":'), enc.encode("1}")] }));
    const r = await createTryRunner(p).run({ method: "POST", url: "http://localhost:3000/users", headers: { "Content-Type": "application/json", Cookie: "x" }, body: "{}" }, dev);
    expect(r).toEqual({ status: 201, headers: { "content-type": "application/json" }, body: '{"id":1}', ms: 25 });
    expect(p.open).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", headers: { "content-type": "application/json" }, body: "{}", mode: "loopback" }), expect.any(AbortSignal));
  });

  it("returns a 3xx as it is and fetches once", async () => {
    const p = ports(() => opened({ status: 302, headers: { location: "https://builderforce.ai/" }, parts: [] }));
    const r = await createTryRunner(p).run(get("http://localhost/x"), dev);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("https://builderforce.ai/");
    expect(p.open).toHaveBeenCalledTimes(1);
  });

  it("stops a streaming body at the cap in bytes, marks it truncated and closes the socket", async () => {
    const destroy = vi.fn();
    const big = new Uint8Array(TRY_BODY_CAP / 2).fill(97);
    const p = ports(() => opened({ destroy, parts: [big, big, big, big] }));
    const r = await createTryRunner(p).run(get("http://localhost/x"), dev);
    expect(r.body).toHaveLength(TRY_BODY_CAP);
    expect(r.truncated).toBe(true);
    expect(destroy).toHaveBeenCalled();
  });

  it("counts bytes, not characters, and does not mark a body of exactly the cap", async () => {
    const two = enc.encode("é".repeat(10)); // 20 bytes
    const cut = await createTryRunner(ports(() => opened({ parts: [two] })), { bodyCap: 11 }).run(get("http://localhost/x"), dev);
    expect(cut.truncated).toBe(true);
    const exact = await createTryRunner(ports(() => opened({ parts: [two] })), { bodyCap: 20 }).run(get("http://localhost/x"), dev);
    expect(exact.truncated).toBeUndefined();
    expect(exact.body).toBe("é".repeat(10));
  });

  it("rejects early when content-length is over the cap", async () => {
    const destroy = vi.fn();
    const p = ports(() => opened({ destroy, headers: { "content-length": String(TRY_BODY_CAP + 1) } }));
    await expect(createTryRunner(p).run(get("http://localhost/x"), dev)).rejects.toMatchObject({ code: "size" });
    expect(destroy).toHaveBeenCalled();
  });

  it("times out during the body, covering headers and body with one deadline", async () => {
    const destroy = vi.fn();
    const never = new Promise<void>(() => undefined);
    const p = ports(() => opened({ destroy, gate: never }));
    await expect(createTryRunner(p, { timeoutMs: 20 }).run(get("http://localhost/x"), dev)).rejects.toMatchObject({ code: "timeout" });
    expect(destroy).toHaveBeenCalled();
    // And during connect/headers.
    const slow: TryPorts = { ...p, open: () => new Promise(() => undefined) };
    await expect(createTryRunner(slow, { timeoutMs: 20 }).run(get("http://localhost/x"), dev)).rejects.toMatchObject({ code: "timeout" });
  });

  it("collapses a network failure into one generic error", async () => {
    for (const message of ["ECONNREFUSED", "ENOTFOUND", "address refused"]) {
      const p: TryPorts = { ...ports(), open: async () => { throw new Error(message); } };
      await expect(createTryRunner(p).run(get("http://localhost/x"), dev)).rejects.toMatchObject({ code: "connect", message: "request failed" });
    }
  });

  it("refuses before any network work: bad origin, port and shape", async () => {
    const p = ports();
    const runner = createTryRunner(p);
    await expect(runner.run(get("https://builderforce.ai/x"), dev)).rejects.toMatchObject({ code: "origin" });
    await expect(runner.run(get("http://localhost:6379/x"), dev)).rejects.toMatchObject({ code: "port" });
    await expect(runner.run({ method: "TRACE", url: "http://localhost/x" }, dev)).rejects.toMatchObject({ code: "method" });
    expect(p.open).not.toHaveBeenCalled();
    expect(p.confirm).not.toHaveBeenCalled();
  });

  it("asks once per origin:port and remembers the answer for the session", async () => {
    const p = ports();
    const runner = createTryRunner(p);
    await runner.run(get("http://localhost:3000/a"), dev);
    await runner.run(get("http://localhost:3000/b"), dev);
    expect(p.confirm).toHaveBeenCalledTimes(1);
    expect(p.confirm).toHaveBeenCalledWith("http:" + "//localhost:3000");
    await runner.run(get("http://localhost:3001/a"), dev);
    await runner.run(get("https://localhost:3000/a"), dev);
    expect(p.confirm).toHaveBeenCalledTimes(3);
  });

  it("does not send when the person declines, and asks again next time", async () => {
    const p = ports(undefined, false);
    const runner = createTryRunner(p);
    await expect(runner.run(get("http://localhost:3000/a"), dev)).rejects.toMatchObject({ code: "declined" });
    await expect(runner.run(get("http://localhost:3000/a"), dev)).rejects.toMatchObject({ code: "declined" });
    expect(p.confirm).toHaveBeenCalledTimes(2);
    expect(p.open).not.toHaveBeenCalled();
  });

  it("allows one request at a time", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const p = ports(() => opened({ gate }));
    const runner = createTryRunner(p);
    const first = runner.run(get("http://localhost:3000/a"), dev);
    await expect(runner.run(get("http://localhost:3000/b"), dev)).rejects.toMatchObject({ code: "busy" });
    release();
    await expect(first).resolves.toMatchObject({ status: 200 });
    await expect(runner.run(get("http://localhost:3000/c"), dev)).resolves.toMatchObject({ status: 200 });
  });
});

describe("userFailureOf", () => {
  it("speaks the refusal in the person's language and logs nothing", () => {
    const log = vi.fn();
    expect(userFailureOf(new TryRequestError("origin", "x"), (c) => `text:${c}`, log).message).toBe("text:origin");
    expect(log).not.toHaveBeenCalled();
  });
  it("shows a generic connect failure for any other error and logs the real one", () => {
    const log = vi.fn();
    expect(userFailureOf(new Error("ECONNRESET boom"), (c) => `text:${c}`, log).message).toBe("text:connect");
    expect(log.mock.calls[0]![0]).toContain("ECONNRESET boom");
  });
});
