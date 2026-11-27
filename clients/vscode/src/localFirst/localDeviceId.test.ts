import { describe, expect, it } from "vitest";
import { LOCAL_DEVICE_ID_KEY, readLocalDeviceId } from "./localDeviceId";

describe("readLocalDeviceId", () => {
  it("keeps the stored key string stable", () => {
    expect(LOCAL_DEVICE_ID_KEY).toBe("builderforce.localDeviceId");
  });

  it("reads the stored id, or empty when unminted", () => {
    const state = new Map<string, unknown>([[LOCAL_DEVICE_ID_KEY, "device-1"]]);
    const reader = { get: <T,>(key: string) => state.get(key) as T | undefined };
    expect(readLocalDeviceId(reader)).toBe("device-1");
    expect(readLocalDeviceId({ get: () => undefined })).toBe("");
  });
});
