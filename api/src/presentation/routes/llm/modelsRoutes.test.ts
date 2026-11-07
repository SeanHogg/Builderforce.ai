import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { HonoEnv } from "../../../env";

const access = vi.hoisted(() => ({ error: undefined as unknown }));

vi.mock("./access", async (orig) => ({
  ...(await orig<typeof import("./access")>()),
  requireTenantAccess: async () => { throw access.error; },
}));

import { TenantAccessError } from "./access";
import { mountModelsRoutes } from "./modelsRoutes";

const app = () => {
  const router = new Hono<HonoEnv>();
  mountModelsRoutes(router);
  return router;
};

describe("GET /v1/models access failures", () => {
  beforeEach(() => { access.error = undefined; });

  it.each([
    [403, "editor_key_required"],
    [403, "workspace_not_member"],
    [400, "workspace_invalid"],
  ] as const)("propagates the workspace refusal %s %s so the editor can react", async (status, code) => {
    access.error = new TenantAccessError(status, code, "refused");
    const res = await app().request("/v1/models", undefined, { JWT_SECRET: "x" } as never);
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });
});
