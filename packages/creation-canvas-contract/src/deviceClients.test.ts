import { describe, expect, it } from 'vitest';
import { DEVICE_CLIENTS, deviceClientName, isDeviceClient } from './deviceClients';

describe('device clients', () => {
  it('names each known app, and falls back to VS Code for an unknown or missing client', () => {
    expect(deviceClientName('vscode')).toBe('VS Code');
    expect(deviceClientName('synapse')).toBe('Synapse');
    expect(deviceClientName('android')).toBe('Builderforce for Android');
    expect(deviceClientName('ios')).toBe('Builderforce for iPhone');
    expect(deviceClientName('macos')).toBe('Builderforce for Mac');
    expect(deviceClientName(null)).toBe(DEVICE_CLIENTS.vscode);
    expect(deviceClientName('something-else')).toBe(DEVICE_CLIENTS.vscode);
  });

  it('recognises only its own keys — never inherited object properties', () => {
    expect(isDeviceClient('synapse')).toBe(true);
    expect(isDeviceClient('toString')).toBe(false);
    expect(isDeviceClient(undefined)).toBe(false);
  });
});
