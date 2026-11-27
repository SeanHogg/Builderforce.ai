import { describe, expect, it, vi } from "vitest";
import { HelperError, LineSplitter, RequestCorrelator, encodeRequest, parseLine } from "./teachHelperProtocol";

describe("encodeRequest / parseLine", () => {
  it("frames a request as one newline-terminated JSON line", () => {
    const line = encodeRequest(3, "record.start", { program: "calc.exe" });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ id: 3, method: "record.start", params: { program: "calc.exe" } });
  });

  it("omits params when there are none", () => {
    expect(JSON.parse(encodeRequest(1, "hello"))).toEqual({ id: 1, method: "hello" });
  });

  it("decodes a result reply, an error reply and an event", () => {
    expect(parseLine('{"id":1,"result":{"protocol":1}}')).toEqual({ kind: "reply", id: 1, result: { protocol: 1 } });
    expect(parseLine('{"id":2,"error":{"code":"busy","message":"a run is active"}}')).toEqual({
      kind: "reply",
      id: 2,
      error: { code: "busy", message: "a run is active" },
    });
    expect(parseLine('{"event":"run.stepStarted","idx":4}')).toEqual({ kind: "event", event: { event: "run.stepStarted", idx: 4 } });
  });

  it("never throws on junk", () => {
    expect(parseLine("not json").kind).toBe("invalid");
    expect(parseLine("[1,2]").kind).toBe("invalid");
    expect(parseLine('{"nothing":true}').kind).toBe("invalid");
  });
});

describe("LineSplitter", () => {
  it("holds a partial line until its newline arrives", () => {
    const s = new LineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1}\n{"b":2}\n{"c"')).toEqual(['{"a":1}', '{"b":2}']);
    expect(s.push(":3}\r\n")).toEqual(['{"c":3}']);
  });

  it("drops blank lines", () => {
    expect(new LineSplitter().push("\n\n{}\n")).toEqual(["{}"]);
  });
});

describe("RequestCorrelator", () => {
  it("resolves the request whose id the reply carries, out of order", async () => {
    const c = new RequestCorrelator();
    const sent: string[] = [];
    const a = c.request("a", undefined, (l) => sent.push(l));
    const b = c.request("b", undefined, (l) => sent.push(l));
    const idOf = (l: string) => (JSON.parse(l) as { id: number }).id;
    c.settle({ kind: "reply", id: idOf(sent[1]!), result: "B" });
    c.settle({ kind: "reply", id: idOf(sent[0]!), result: "A" });
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
    expect(c.inFlight).toBe(0);
  });

  it("rejects with a HelperError carrying the helper's code", async () => {
    const c = new RequestCorrelator();
    let line = "";
    const p = c.request("run.start", {}, (l) => (line = l));
    c.settle({ kind: "reply", id: (JSON.parse(line) as { id: number }).id, error: { code: "busy", message: "busy" } });
    await expect(p).rejects.toMatchObject({ name: "HelperError", code: "busy" });
    await expect(p).rejects.toBeInstanceOf(HelperError);
  });

  it("ignores a reply nobody is waiting on", () => {
    expect(new RequestCorrelator().settle({ kind: "reply", id: 99, result: 1 })).toBe(false);
  });

  it("rejectAll fails everything in flight", async () => {
    const c = new RequestCorrelator();
    const p = c.request("hello", undefined, () => undefined);
    c.rejectAll(new HelperError("helper_gone", "exited"));
    await expect(p).rejects.toMatchObject({ code: "helper_gone" });
  });

  it("a null-id error reply settles the OLDEST pending request", async () => {
    const c = new RequestCorrelator();
    const first = c.request("a", undefined, () => undefined);
    const second = c.request("b", undefined, () => undefined);
    const msg = parseLine('{"id":null,"error":{"code":"bad_request","message":"unreadable"}}');
    expect(msg.kind).toBe("reply");
    if (msg.kind === "reply") expect(c.settle(msg)).toBe(true);
    await expect(first).rejects.toMatchObject({ code: "bad_request" });
    expect(c.inFlight).toBe(1);
    c.rejectAll(new Error("done"));
    await expect(second).rejects.toThrow("done");
  });

  it("times a request out after 30 s by default, but never when told null", async () => {
    vi.useFakeTimers();
    try {
      const c = new RequestCorrelator();
      const timed = c.request("hello", undefined, () => undefined);
      const open = c.request("record.stop", undefined, () => undefined, { timeoutMs: null });
      const assertion = expect(timed).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(30_001);
      await assertion;
      expect(c.inFlight).toBe(1);
      c.rejectAll(new Error("end"));
      await expect(open).rejects.toThrow("end");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a send that throws rejects the request and leaves nothing pending", async () => {
    const c = new RequestCorrelator();
    await expect(c.request("x", undefined, () => { throw new Error("stdin closed"); })).rejects.toThrow("stdin closed");
    expect(c.inFlight).toBe(0);
  });
});
