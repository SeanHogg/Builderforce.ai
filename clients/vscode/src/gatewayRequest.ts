/**
 * The editor's authenticated gateway call in the shape `@builderforce/provider-connect`
 * takes: the status rides with the body instead of a non-2xx throwing, because every
 * provider-connect decision turns on it (404 → connect first, 409 → reconnect).
 *
 * Throws only when there is no answer at all (signed out, offline) — `authedRaw`'s own
 * `NOT_SIGNED_IN` — which the package treats as "unavailable, ask again later".
 */
import type * as vscode from "vscode";
import type { GatewayRequest } from "@builderforce/provider-connect";
import { authedRaw } from "./bfApi";

export function gatewayRequest(secrets: vscode.SecretStorage): GatewayRequest {
  return async (path, init) => {
    const res = await authedRaw<unknown>(secrets, path, {
      method: init?.method ?? "GET",
      ...(init?.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    });
    return { status: res.status, body: res.body };
  };
}
