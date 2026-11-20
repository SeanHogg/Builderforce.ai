import { beforeEach, describe, expect, it, vi } from "vitest";

const authed = vi.hoisted(() => vi.fn());
vi.mock("./transport", () => ({ authed: (...a: unknown[]) => authed(...a) }));

import { fetchProjectShipPolicy } from "./runContext";

const secrets = {} as never;

/** The `GET /api/manager/:projectId` body as the api builds it (`manager/shipPolicyOf.ts` `shipPoliciesOf`). */
function managerBody(local: Record<string, unknown>) {
  return {
    policy: { shipMode: local.mode },
    shipPolicy: { local, cloud: { mode: "pull_request", merge: "never", review: "none", source: "project_settings" } },
  };
}

beforeEach(() => authed.mockReset());

describe("fetchProjectShipPolicy — reads `shipPolicy.local` off the manager response (PRD 48)", () => {
  it("returns the project's local policy, never the cloud one", async () => {
    authed.mockResolvedValueOnce(managerBody({ mode: "commit_push", merge: "never", review: "none", source: "project_settings" }));
    await expect(fetchProjectShipPolicy(secrets, 3)).resolves.toEqual({ mode: "commit_push", merge: "never", review: "none", source: "project_settings" });
    expect(authed).toHaveBeenCalledWith(secrets, "/api/manager/3");
  });

  it("keeps a `default` source, so an unset project's run says the policy is unset", async () => {
    authed.mockResolvedValueOnce(managerBody({ mode: "commit", merge: "never", review: "none", source: "default" }));
    await expect(fetchProjectShipPolicy(secrets, 3)).resolves.toMatchObject({ mode: "commit", source: "default" });
  });

  it("is undefined when signed out, or when `local` is missing or malformed", async () => {
    authed.mockResolvedValueOnce(undefined);
    await expect(fetchProjectShipPolicy(secrets, 3)).resolves.toBeUndefined();
    authed.mockResolvedValueOnce({ shipPolicy: { cloud: { mode: "pull_request" } } });
    await expect(fetchProjectShipPolicy(secrets, 3)).resolves.toBeUndefined();
    authed.mockResolvedValueOnce(managerBody({ mode: "yolo", source: "project_settings" }));
    await expect(fetchProjectShipPolicy(secrets, 3)).resolves.toBeUndefined();
  });
});
