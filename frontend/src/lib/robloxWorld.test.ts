import { describe, expect, it } from 'vitest';
import { robloxScriptsFrom, robloxWorldReading, robloxWorldSceneFrom, STUDS_TO_UNITS } from '@builderforce/creation-canvas-contract';

/**
 * Reading a `.rbxlx` back as a walkable world.
 *
 * The fixture is written the way `rbxlxFromSpec` writes one — lowercase
 * `<Vector3 name="size">`, a packed `Color3uint8`, a `bf_role` marker as a CHILD
 * instance, a baseplate centred at y=-2 so its top face is the floor. Those are
 * exactly the details that are easy to get wrong in a parser and impossible to
 * notice without a test, which is why the shape is asserted rather than trusted.
 */
function place(parts: string, extra = ''): string {
  return `<roblox version="4">
<Item class="Workspace" referent="RBX0">
<Properties><string name="Name">Workspace</string></Properties>
<Item class="Part" referent="RBX1">
<Properties>
<bool name="Anchored">true</bool>
<bool name="CanCollide">true</bool>
<Color3uint8 name="Color3uint8">${(0xff000000 + (0x4f << 16) + (0x79 << 8) + 0x42) >>> 0}</Color3uint8>
<CoordinateFrame name="CFrame"><X>0</X><Y>-2</Y><Z>0</Z><R00>1</R00></CoordinateFrame>
<string name="Name">Baseplate</string>
<Vector3 name="size"><X>512</X><Y>4</Y><Z>512</Z></Vector3>
</Properties>
</Item>
<Item class="SpawnLocation" referent="RBX2">
<Properties>
<CoordinateFrame name="CFrame"><X>10</X><Y>4</Y><Z>-5</Z></CoordinateFrame>
<string name="Name">SpawnLocation</string>
<Vector3 name="size"><X>12</X><Y>1</Y><Z>12</Z></Vector3>
</Properties>
</Item>
${parts}
</Item>
${extra}
</roblox>`;
}

function part(name: string, role: string, options: { anchored?: boolean; y?: number } = {}): string {
  return `<Item class="Part" referent="RBX9">
<Properties>
<bool name="Anchored">${options.anchored === false ? 'false' : 'true'}</bool>
<Color3uint8 name="Color3uint8">${(0xff000000 + (0x22 << 16) + (0xc5 << 8) + 0x5e) >>> 0}</Color3uint8>
<CoordinateFrame name="CFrame"><X>20</X><Y>${options.y ?? 5}</Y><Z>-30</Z></CoordinateFrame>
<string name="Name">${name}</string>
<Vector3 name="size"><X>10</X><Y>2</Y><Z>6</Z></Vector3>
</Properties>
<Item class="StringValue" referent="RBX10">
<Properties><string name="Name">bf_role</string><string name="Value">${role}</string></Properties>
</Item>
</Item>`;
}

describe('reading a Roblox place as a world', () => {
  it('turns parts into props at the same place, in world units', () => {
    const reading = robloxWorldReading(place(part('Ledge', 'platform')))!;
    expect(reading.partCount).toBe(1);
    const prop = reading.scene.props[0]!;
    expect(prop.kind).toBe('platform');
    expect(prop.position).toEqual([20 * STUDS_TO_UNITS, 5 * STUDS_TO_UNITS, -30 * STUDS_TO_UNITS]);
    // Scale is the FULL size — `PropMesh` draws a unit box and scales it.
    expect(prop.scale).toEqual([10 * STUDS_TO_UNITS, 2 * STUDS_TO_UNITS, 6 * STUDS_TO_UNITS]);
  });

  it('unpacks the colour out of the alpha-prefixed uint32 Roblox writes', () => {
    // Reading the raw number as RGB gives black, which looks like a lighting bug
    // rather than a parse bug — the exact failure the writer's own note warns of.
    const reading = robloxWorldReading(place(part('Ledge', 'platform')))!;
    expect(reading.scene.props[0]!.color).toBe('#22c55e');
    expect(reading.scene.ground.color).toBe('#4f7942');
  });

  it('reads the role off the CHILD marker, not the part name', () => {
    const reading = robloxWorldReading(place([
      part('Coin', 'collectible'),
      part('Finish', 'goal'),
      part('Spikes', 'hazard'),
      part('Crate', 'obstacle', { anchored: false }),
    ].join('\n')))!;
    expect(reading.scene.props.map((prop) => prop.kind)).toEqual(['collectible', 'goal', 'hazard', 'block']);
    expect(reading.collectibles).toBe(1);
    expect(reading.goals).toBe(1);
    expect(reading.hazards).toBe(1);
  });

  it('keeps the three gameplay roles walk-through, and unanchored parts dynamic', () => {
    // A collectible you cannot walk into is not a collectible, and a crate the
    // engine will not move is scenery.
    const reading = robloxWorldReading(place([
      part('Coin', 'collectible'),
      part('Crate', 'obstacle', { anchored: false }),
      part('Wall', 'obstacle'),
    ].join('\n')))!;
    expect(reading.scene.props.map((prop) => prop.physics)).toEqual(['sensor', 'dynamic', 'static']);
  });

  it('makes the baseplate the ground rather than a 205-unit box standing on it', () => {
    const reading = robloxWorldReading(place(part('Ledge', 'platform')))!;
    expect(reading.scene.props).toHaveLength(1);
    expect(reading.scene.ground.size).toBeCloseTo(512 * STUDS_TO_UNITS);
  });

  it('spawns the walker ABOVE the pad, not inside it', () => {
    const reading = robloxWorldReading(place(part('Ledge', 'platform')))!;
    const [x, y, z] = reading.scene.spawn.position;
    expect(x).toBeCloseTo(10 * STUDS_TO_UNITS);
    expect(z).toBeCloseTo(-5 * STUDS_TO_UNITS);
    expect(y).toBeGreaterThan(4 * STUDS_TO_UNITS);
  });

  it('refuses a document that is not a place, and a place with no world in it', () => {
    expect(robloxWorldSceneFrom('<!doctype html><html></html>')).toBeNull();
    expect(robloxWorldSceneFrom('')).toBeNull();
    // Baseplate and spawn only: nothing was built, so there is nothing to play.
    expect(robloxWorldSceneFrom(place(''))).toBeNull();
  });

  it('scales so a Roblox-sized jump stays a Roblox-sized jump', () => {
    // The walker is a 2.0-unit capsule and a Roblox character is ~5 studs. Break
    // this and every generated place becomes either a canyon or a kerb.
    expect(STUDS_TO_UNITS).toBeCloseTo(2 / 5);
  });
});

describe('reading the Luau back out of a place', () => {
  const scripts = `<Item class="ServerScriptService" referent="RBX20">
<Properties><string name="Name">ServerScriptService</string></Properties>
<Item class="Script" referent="RBX21">
<Properties>
<string name="Name">GameServer</string>
<ProtectedString name="Source"><![CDATA[local t = data[a[b]]]]><![CDATA[>0
print("hi")]]></ProtectedString>
</Properties>
</Item>
</Item>`;

  it('returns each script with the name and class it has in Studio', () => {
    const found = robloxScriptsFrom(place('', scripts));
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe('GameServer');
    expect(found[0]!.className).toBe('Script');
  });

  it('rejoins a CDATA section the writer had to split', () => {
    // `]]>` is legal Luau (`a[b[c]]>d`) and illegal inside CDATA, so the writer
    // splits it across two sections. Not rejoining leaves `<![CDATA[` sitting in
    // the middle of somebody's source.
    const source = robloxScriptsFrom(place('', scripts))[0]!.source;
    expect(source).toBe('local t = data[a[b]]>0\nprint("hi")');
    expect(source).not.toContain('CDATA');
  });

  it('has nothing to say about a document with no scripts', () => {
    expect(robloxScriptsFrom(place(part('Ledge', 'platform')))).toEqual([]);
    expect(robloxScriptsFrom('')).toEqual([]);
  });
});
