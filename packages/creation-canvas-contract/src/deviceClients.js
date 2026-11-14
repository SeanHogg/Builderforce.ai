/**
 * The apps that sign in to Builderforce with the device flow (`/api/auth/device/code`
 * → `/activate` → a `bfk_` key), and what a person calls each one. The API names the
 * key it mints after the client, and `/activate` tells the person which app to check
 * the code against and return to — one list, so neither can name the wrong app.
 */
export const DEVICE_CLIENTS = {
    vscode: 'VS Code',
    synapse: 'Synapse',
    spawn: 'Spawn',
    android: 'Builderforce for Android',
    ios: 'Builderforce for iPhone',
    macos: 'Builderforce for Mac',
    // Rovr, the Chrome extension (`clients/chrome`). A brand, like every name here.
    chrome: 'Rovr for Chrome',
};
export function isDeviceClient(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DEVICE_CLIENTS, value);
}
/** The app's name; an unknown or missing client is the original editor, VS Code. */
export function deviceClientName(client) {
    return isDeviceClient(client) ? DEVICE_CLIENTS[client] : DEVICE_CLIENTS.vscode;
}
//# sourceMappingURL=deviceClients.js.map