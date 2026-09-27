/**
 * The apps that sign in to Builderforce with the device flow (`/api/auth/device/code`
 * → `/activate` → a `bfk_` key), and what a person calls each one. The API names the
 * key it mints after the client, and `/activate` tells the person which app to check
 * the code against and return to — one list, so neither can name the wrong app.
 */
export const DEVICE_CLIENTS = {
  vscode: 'VS Code',
  synapse: 'Synapse',
} as const;

export type DeviceClient = keyof typeof DEVICE_CLIENTS;

export function isDeviceClient(value: unknown): value is DeviceClient {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEVICE_CLIENTS, value);
}

/** The app's name; an unknown or missing client is the original editor, VS Code. */
export function deviceClientName(client: string | null | undefined): string {
  return isDeviceClient(client) ? DEVICE_CLIENTS[client] : DEVICE_CLIENTS.vscode;
}
