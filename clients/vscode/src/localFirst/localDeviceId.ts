/**
 * The ONE spelling of the key this install's durable device id is stored under in
 * `globalState`. `localFirstStore` mints it; every other reader goes through
 * `readLocalDeviceId`. The string must never change: it would split device identity.
 */
export const LOCAL_DEVICE_ID_KEY = "builderforce.localDeviceId";

/** The stored device id, or "" when none has been minted yet. */
export function readLocalDeviceId(state: { get<T>(key: string): T | undefined }): string {
  return state.get<string>(LOCAL_DEVICE_ID_KEY) ?? "";
}
