import { EventEmitter } from "node:events";
import type { Express } from "express";
import { describe, expect, it, vi } from "vitest";
import { installBrowserCommonMiddleware } from "./server-middleware.js";

type Handler = (req: unknown, res: unknown, next: () => void) => void;

function captureHandlers(): Handler[] {
  const handlers: Handler[] = [];
  installBrowserCommonMiddleware({
    use: (handler: Handler) => handlers.push(handler),
  } as unknown as Express);
  return handlers;
}

/** Mirrors Node >= 24.20, where `IncomingMessage.prototype.signal` is a getter-only accessor. */
function makeRequestWithGetterOnlySignal() {
  const proto = Object.create(EventEmitter.prototype) as object;
  Object.defineProperty(proto, "signal", { get: () => undefined, configurable: true });
  const req = Object.create(proto) as EventEmitter & { signal?: AbortSignal };
  EventEmitter.call(req);
  return req;
}

describe("installBrowserCommonMiddleware", () => {
  it("exposes an abort signal even when the request prototype's signal is getter-only", () => {
    const [attachSignal] = captureHandlers();
    const req = makeRequestWithGetterOnlySignal();
    const res = Object.assign(new EventEmitter(), { writableEnded: false });
    const next = vi.fn();

    attachSignal(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.signal).toBeInstanceOf(AbortSignal);
    expect(req.signal?.aborted).toBe(false);

    req.emit("aborted");
    expect(req.signal?.aborted).toBe(true);
  });

  it("aborts when the response closes before it finished writing", () => {
    const [attachSignal] = captureHandlers();
    const req = makeRequestWithGetterOnlySignal();
    const res = Object.assign(new EventEmitter(), { writableEnded: false });

    attachSignal(req, res, () => {});
    res.emit("close");

    expect(req.signal?.aborted).toBe(true);
  });
});
