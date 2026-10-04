import { describe, expect, it } from 'vitest';
import { forbiddenSourceReason, readPath, readSpawnOps, readValue, MAX_OPS } from './spawnOps';
import { isOldEnough, readBirthMonth } from './spawnAge';
import { readBuildRequest, renderBuildUserMessage, SPAWN_SYSTEM_PROMPT } from './spawnPrompt';
import { SPAWN_PLAN, SPAWN_TOKEN_PACKS, spawnTokenPack } from './spawnCatalog';
import { spawnPriceList } from './spawnAccount';

describe('the Spawn price list', () => {
  it('is $1.99 a month with packs of $10, $20, $50 and $100', () => {
    expect(SPAWN_PLAN.monthlyCents).toBe(199);
    expect(SPAWN_TOKEN_PACKS.map((p) => p.cents)).toEqual([1000, 2000, 5000, 10000]);
  });

  it('never gives fewer tokens per dollar for a bigger pack', () => {
    const rates = SPAWN_TOKEN_PACKS.map((p) => p.tokens / p.cents);
    for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThanOrEqual(rates[i - 1]!);
  });

  it('finds a pack by id and refuses one that does not exist', () => {
    expect(spawnTokenPack('spawn-50')?.cents).toBe(5000);
    expect(spawnTokenPack('spawn-5')).toBeNull();
  });

  it('shows an estimated build count for each pack', () => {
    for (const pack of spawnPriceList().packs) expect(pack.estimatedBuilds).toBeGreaterThan(0);
  });
});

describe('the 13+ line', () => {
  const on = (iso: string) => new Date(`${iso}T12:00:00Z`);

  it('treats a birth month as its last day, so nobody passes early', () => {
    // Born March 2013: 13 by April 1 2026 at the latest, possibly not in March.
    expect(isOldEnough(2013, 3, on('2026-03-31'))).toBe(false);
    expect(isOldEnough(2013, 3, on('2026-04-01'))).toBe(true);
  });

  it('handles a December birth month across the year boundary', () => {
    expect(isOldEnough(2012, 12, on('2025-12-31'))).toBe(false);
    expect(isOldEnough(2012, 12, on('2026-01-01'))).toBe(true);
  });

  it('refuses months and years nobody could have', () => {
    const today = on('2026-10-04');
    expect(readBirthMonth(2010, 0, today)).toBeNull();
    expect(readBirthMonth(2010, 13, today)).toBeNull();
    expect(readBirthMonth(1850, 5, today)).toBeNull();
    expect(readBirthMonth(2027, 1, today)).toBeNull();
    expect(readBirthMonth('2011', '7', today)).toEqual({ year: 2011, month: 7 });
  });
});

describe('the operation safety gate', () => {
  it('accepts a path inside a place Spawn builds in, and nothing outside', () => {
    expect(readPath('Workspace/Obby/Stage1')).toEqual({ path: 'Workspace/Obby/Stage1' });
    expect(readPath(' ServerScriptService / Coins ')).toEqual({ path: 'ServerScriptService/Coins' });
    expect(readPath('CoreGui/Evil')).toHaveProperty('reason');
    expect(readPath('Workspace')).toHaveProperty('reason');
    expect(readPath('')).toHaveProperty('reason');
  });

  it.each([
    ['local h = game:GetService("HttpService")', 'HttpService'],
    ['loadstring(code)()', 'loadstring'],
    ['setfenv(1, {})', 'setfenv'],
    ['local m = require(123456789)', 'require(id)'],
    ['local img = "rbxassetid://42"', 'asset'],
  ])('refuses a backdoor-shaped script: %s', (source, label) => {
    expect(forbiddenSourceReason(source), label).not.toBeNull();
  });

  it('lets an ordinary script through, including require of a module by path', () => {
    const source = 'local Coins = require(game.ReplicatedStorage.Coins)\nPlayers.PlayerAdded:Connect(function(p) end)';
    expect(forbiddenSourceReason(source)).toBeNull();
  });

  it('reads typed property values and refuses shapes the plugin cannot apply', () => {
    expect(readValue({ Vector3: [1, 2, 3] })).toEqual({ Vector3: [1, 2, 3] });
    expect(readValue({ Color3: '#FF00AA' })).toEqual({ Color3: '#ff00aa' });
    expect(readValue({ CFrame: [1, 2, 3] })).toEqual({ CFrame: [1, 2, 3, 0, 0, 0] });
    expect(readValue({ Enum: 'Enum.Material.Neon' })).toEqual({ Enum: 'Material.Neon' });
    expect(readValue({ Vector3: [1, 2] })).toBeNull();
    expect(readValue({ Color3: 'red' })).toBeNull();
    expect(readValue({ Vector3: [1, 2, 3], Color3: '#000000' })).toBeNull();
    expect(readValue(Number.NaN)).toBeNull();
  });

  it('keeps good operations and says why each bad one was refused', () => {
    const { ops, rejected } = readSpawnOps([
      { op: 'instance', path: 'Workspace/Obby/Stage1', className: 'Part', properties: { Size: { Vector3: [8, 1, 8] }, Anchored: true } },
      { op: 'script', path: 'ServerScriptService/Coins', kind: 'Script', source: 'print("coins")' },
      { op: 'script', path: 'ServerScriptService/Backdoor', kind: 'Script', source: 'loadstring(x)()' },
      { op: 'instance', path: 'Workspace/Img', className: 'Decal', properties: {} },
      { op: 'instance', path: 'StarterGui/Hud/Logo', className: 'ImageLabel', properties: {} },
      { op: 'instance', path: 'Workspace/Sound', className: 'Part', properties: { SoundId: 'rbxassetid://1' } },
      { op: 'delete', path: 'Workspace/Old' },
      { op: 'teleport', path: 'Workspace/X' },
    ]);
    expect(ops.map((o) => o.op)).toEqual(['instance', 'script', 'delete']);
    expect(rejected.map((r) => r.index)).toEqual([2, 3, 4, 5, 7]);
    expect(rejected.every((r) => r.reason.length > 0)).toBe(true);
  });

  it('lets the path decide Name and Parent, whatever the properties say', () => {
    const { ops } = readSpawnOps([
      { op: 'instance', path: 'Workspace/Goal', className: 'Part', properties: { Name: 'Other', Parent: 'Lighting' } },
    ]);
    expect(ops[0]).toEqual({ op: 'instance', path: 'Workspace/Goal', className: 'Part', properties: {} });
  });

  it('caps a runaway build at the operation limit', () => {
    const many = Array.from({ length: MAX_OPS + 5 }, (_, i) => ({ op: 'delete', path: `Workspace/P${i}` }));
    const { ops, rejected } = readSpawnOps(many);
    expect(ops).toHaveLength(MAX_OPS);
    expect(rejected).toHaveLength(1);
  });

  it('reads nothing from an answer that is not a list', () => {
    expect(readSpawnOps({ op: 'delete' })).toEqual({ ops: [], rejected: [] });
  });
});

describe('the build request', () => {
  it('bounds everything the plugin sends', () => {
    const request = readBuildRequest({
      prompt: `  ${'x'.repeat(10_000)}  `,
      place: {
        tree: 'y'.repeat(100_000),
        scripts: Array.from({ length: 20 }, (_, i) => ({ path: `ServerScriptService/S${i}`, kind: 'Script', source: 'z'.repeat(20_000) })),
        errors: Array.from({ length: 50 }, (_, i) => `error ${i}`),
      },
      history: Array.from({ length: 30 }, () => ({ role: 'player', text: 'hi' })),
    });
    expect(request.prompt.length).toBeLessThanOrEqual(4_000);
    expect(request.place.tree.length).toBeLessThanOrEqual(24_000);
    expect(request.place.scripts.reduce((n, s) => n + s.source.length, 0)).toBeLessThanOrEqual(60_000);
    expect(request.place.errors).toHaveLength(20);
    expect(request.history.length).toBeLessThanOrEqual(8);
  });

  it('survives a malformed body without throwing', () => {
    expect(readBuildRequest(null)).toEqual({ prompt: '', place: { tree: '', scripts: [], errors: [] }, history: [] });
    expect(readBuildRequest({ place: 'nope', history: 'nope' }).history).toEqual([]);
  });

  it('shows the model the place, the errors and the request', () => {
    const message = renderBuildUserMessage(readBuildRequest({
      prompt: 'add a timer',
      place: { tree: 'Workspace [Workspace]', scripts: [{ path: 'ServerScriptService/A', kind: 'Script', source: 'print(1)' }], errors: ['boom'] },
    }));
    expect(message).toContain('Workspace [Workspace]');
    expect(message).toContain('print(1)');
    expect(message).toContain('- boom');
    expect(message).toContain('add a timer');
  });

  it('tells the model the same rules the gate enforces', () => {
    for (const rule of ['HttpService', 'loadstring', 'rbxassetid', 'Community Standards', '"refused": true']) {
      expect(SPAWN_SYSTEM_PROMPT).toContain(rule);
    }
  });
});
