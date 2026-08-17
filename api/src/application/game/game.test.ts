import { describe, expect, it } from 'vitest';
import { robloxScriptsFrom, robloxWorldReading, STUDS_TO_UNITS } from '@builderforce/creation-canvas-contract';
import {
  CANVAS_GAME_ACCOUNT_GATE,
  CANVAS_GAME_TOOL,
  CREATION_CANVAS_TOOLS,
  GAME_PLATFORMS,
  GUEST_GATED_CANVAS_TOOLS,
  canvasGameToolRedirect,
  isGamePlatform,
} from '@builderforce/creation-canvas-contract';
import {
  accentFromTitle,
  escapeHtml,
  gameSlug,
  injectIntoHead,
  normalizeGameDocument,
  validateGameDocument,
  withTouchControls,
} from './gameDocument';
import { encodePng, gameIconPng } from './pngIcon';
import {
  clientScriptLuau,
  rbxlxFromSpec,
  readRobloxSpec,
  rojoProjectJson,
  serverScriptLuau,
  worldBuilderLuau,
  type RobloxGameSpec,
} from './robloxPlace';
import { readPublishTarget } from './robloxCloud';
import { bundleIdFor } from './adapters/capacitor';
import { capacitorWorkflowFiles } from './adapters/capacitorWorkflows';
import { webTarget } from './adapters/web';
import { pwaTarget } from './adapters/pwa';
import { androidTarget } from './adapters/android';
import { iosTarget } from './adapters/ios';
import { robloxTarget } from './adapters/roblox';
import { buildGame, GAME_TARGET_LIST, resolveGameTarget } from './index';
import type { GameTarget, GameTargetContext } from './gameTarget';

/** A document that passes every check: interactive, self-contained, offline. */
const PLAYABLE = `<!doctype html><html><head><meta charset="utf-8"><title>Runner</title></head>
<body><canvas id="c"></canvas>
<script>
  const canvas = document.getElementById('c');
  let score = 0;
  addEventListener('keydown', (e) => { if (e.key === ' ') score++; });
  addEventListener('pointerdown', () => score++);
  function loop() { requestAnimationFrame(loop); }
  loop();
</script></body></html>`;

function context(overrides: Partial<GameTargetContext> = {}): GameTargetContext {
  return {
    projectId: 7,
    tenantId: 3,
    projectName: 'Test project',
    apiOrigin: 'https://api.builderforce.ai',
    siteUrl: null,
    secretNames: [],
    game: {
      title: 'Space Blaster',
      slug: 'space-blaster',
      brief: 'Shoot the asteroids before they reach the bottom.',
      html: PLAYABLE,
      accent: '#3978f6',
    },
    ...overrides,
  };
}

describe('the generated document', () => {
  it('accepts a real game', () => {
    expect(validateGameDocument(PLAYABLE)).toEqual({ ok: true });
  });

  it('rejects a document with no script, because nothing in it can be played', () => {
    const poster = `<!doctype html><html><body><h1>Space Blaster</h1>${'<p>A game.</p>'.repeat(20)}</body></html>`;
    const result = validateGameDocument(poster);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/no script/i);
  });

  it('rejects a game that loads its engine from a CDN — the player has no network', () => {
    const cdn = PLAYABLE.replace('<script>', '<script src="https://cdn.example.com/phaser.js"></script><script>');
    const result = validateGameDocument(cdn);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/another site/i);
  });

  it('rejects an apology, which is neither HTML nor a game', () => {
    expect(validateGameDocument("I'm sorry, I can't help with that.").ok).toBe(false);
  });

  it('gives a bare fragment a doctype, a charset and a title', () => {
    const normalized = normalizeGameDocument('<div id="game"></div><script>void 0;</script>', 'My Game');
    expect(normalized).toMatch(/^<!doctype html>/i);
    expect(normalized).toContain('charset="utf-8"');
    expect(normalized).toContain('<title>My Game</title>');
  });

  it('escapes a title that would otherwise close the tag it sits in', () => {
    expect(normalizeGameDocument('<script>void 0;</script>', '</title><script>alert(1)</script>'))
      .toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('injects into an existing head, a bare html tag, and a doctype-only document alike', () => {
    expect(injectIntoHead('<!doctype html><html><head><title>a</title></head><body></body></html>', '<meta name="x">'))
      .toMatch(/<head>\s*<meta name="x">\s*<title>a<\/title>/);
    expect(injectIntoHead('<html><body></body></html>', '<meta name="x">'))
      .toMatch(/<html>\s*<head>\s*<meta name="x">\s*<\/head>/);
    expect(injectIntoHead('<!doctype html><body></body>', '<meta name="x">'))
      .toMatch(/^<!doctype html>\s*<meta name="x">/i);
  });
});

describe('the touch layer', () => {
  const adapted = withTouchControls(PLAYABLE, '#3978f6');

  it('adds a pad that synthesises the keys a generated game already listens for', () => {
    expect(adapted).toContain('id="bf-pad"');
    expect(adapted).toContain('data-bf-key="ArrowLeft"');
    expect(adapted).toContain("dispatchEvent(new KeyboardEvent(type, init))");
  });

  it('sets a viewport that covers the notch rather than adding a second one', () => {
    const withViewport = withTouchControls(
      PLAYABLE.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=800">'),
      '#3978f6',
    );
    expect(withViewport.match(/name="viewport"/g)).toHaveLength(1);
    expect(withViewport).toContain('viewport-fit=cover');
  });

  it('hides the pad on anything with a real keyboard', () => {
    expect(adapted).toContain('@media (pointer: coarse) and (hover: none)');
  });

  it('leaves the game itself intact', () => {
    expect(adapted).toContain("addEventListener('keydown'");
    expect(adapted).toContain('requestAnimationFrame(loop)');
  });
});

describe('identity', () => {
  it('derives the same accent for the same title every time', () => {
    expect(accentFromTitle('Space Blaster')).toBe(accentFromTitle('Space Blaster'));
    expect(accentFromTitle('Space Blaster')).toMatch(/^#[0-9a-f]{6}$/);
    expect(accentFromTitle('Space Blaster')).not.toBe(accentFromTitle('Cave Diver'));
  });

  it('never produces an empty slug', () => {
    expect(gameSlug('Space Blaster!!')).toBe('space-blaster');
    expect(gameSlug('***')).toBe('builderforce-game');
  });

  it('produces a bundle id Gradle will accept', () => {
    expect(bundleIdFor('space-blaster')).toBe('ai.builderforce.game.space_blaster');
    // A leading digit is an illegal Java identifier and fails late in the build.
    expect(bundleIdFor('2048')).toBe('ai.builderforce.game.g2048');
    expect(bundleIdFor('space-blaster')).not.toMatch(/-/);
  });
});

describe('app icons', () => {
  const png = gameIconPng(192, '#3978f6');

  it('is a real PNG', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR width/height, big-endian, immediately after the 8-byte signature +
    // 4-byte length + 4-byte type.
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(192);
    expect(view.getUint32(20)).toBe(192);
  });

  it('ends with IEND, so a decoder knows it is complete', () => {
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });

  it('is byte-identical for the same input, so a republish does not churn the home screen', () => {
    expect(gameIconPng(192, '#3978f6')).toEqual(gameIconPng(192, '#3978f6'));
    expect(gameIconPng(192, '#ff0000')).not.toEqual(gameIconPng(192, '#3978f6'));
  });

  it('encodes the pixels it was given', () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(255);
    const tiny = encodePng(4, 4, pixels);
    const view = new DataView(tiny.buffer, tiny.byteOffset);
    expect(view.getUint32(16)).toBe(4);
    expect(view.getUint32(20)).toBe(4);
  });
});

describe('reading a generated Roblox place', () => {
  const valid = {
    name: 'Tower Climb',
    summary: 'Climb the tower.',
    spawnX: 0,
    spawnY: 4,
    spawnZ: 0,
    baseplateColor: '#4f7942',
    parts: [
      { name: 'Ledge', x: 0, y: 6, z: 10, width: 12, height: 1, depth: 6, color: '#c0c0c0', anchored: true, role: 'platform' },
      { name: 'Coin', x: 0, y: 8, z: 10, width: 2, height: 2, depth: 2, color: '#ffd700', anchored: true, role: 'collectible' },
    ],
    serverScript: 'local Players = game:GetService("Players")\nprint("server ready for the tower climb")',
    clientScript: 'print("client")',
  };

  it('reads a well-formed spec', () => {
    const spec = readRobloxSpec(valid);
    expect(spec?.parts).toHaveLength(2);
    expect(spec?.parts[1]!.role).toBe('collectible');
  });

  it('rejects a place with no parts — that is an empty world, not a game', () => {
    expect(readRobloxSpec({ ...valid, parts: [] })).toBeNull();
  });

  it('rejects a place with no server script, because nothing would enforce the rules', () => {
    expect(readRobloxSpec({ ...valid, serverScript: 'x' })).toBeNull();
  });

  it('clamps a misjudged scale rather than rejecting it — the place still opens', () => {
    const spec = readRobloxSpec({
      ...valid,
      parts: [{ ...valid.parts[0], width: 999_999 }],
    });
    expect(spec?.parts[0]!.width).toBe(2048);
  });

  it('falls back to a safe role and colour rather than emitting an invalid part', () => {
    const spec = readRobloxSpec({
      ...valid,
      parts: [{ ...valid.parts[0], role: 'boss-arena', color: 'gold' }],
    });
    expect(spec?.parts[0]!.role).toBe('decor');
    expect(spec?.parts[0]!.color).toBe('#9aa5b1');
  });
});

describe('emitting a .rbxlx place', () => {
  const spec = readRobloxSpec({
    name: 'Tower Climb',
    summary: 'Climb.',
    spawnX: 0,
    spawnY: 4,
    spawnZ: 0,
    baseplateColor: '#4f7942',
    parts: [
      { name: 'Ledge', x: 1, y: 6, z: 10, width: 12, height: 1, depth: 6, color: '#ff0000', anchored: true, role: 'platform' },
      { name: 'Coin', x: 0, y: 8, z: 10, width: 2, height: 2, depth: 2, color: '#ffd700', anchored: true, role: 'collectible' },
    ],
    serverScript: 'local CollectionService = game:GetService("CollectionService")\nprint("rules")',
    clientScript: 'print("hud")',
  })!;
  const place = rbxlxFromSpec(spec);

  it('is a version 4 place with the schema Studio expects', () => {
    expect(place).toMatch(/^<roblox [^>]*version="4">/);
    expect(place).toContain('xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd"');
    expect(place.trimEnd().endsWith('</roblox>')).toBe(true);
  });

  it('carries the services the generated scripts assume exist', () => {
    for (const service of ['Workspace', 'Lighting', 'ReplicatedStorage', 'ServerScriptService', 'StarterPlayerScripts']) {
      expect(place).toContain(`class="${service}"`);
    }
  });

  it('serialises Size as the lowercase name Roblox actually reads', () => {
    // `<Vector3 name="Size">` is silently ignored and every part comes out 4×1.2×2.
    expect(place).toContain('<Vector3 name="size">');
    expect(place).not.toContain('<Vector3 name="Size">');
  });

  it('packs colour with an opaque alpha, so parts are not transparent black', () => {
    // #ff0000 → 0xFFFF0000 → 4294901760.
    expect(place).toContain('<Color3uint8 name="Color3uint8">4294901760</Color3uint8>');
  });

  it('gives every referent a distinct id', () => {
    const referents = [...place.matchAll(/referent="(RBX\d+)"/g)].map((match) => match[1]);
    expect(new Set(referents).size).toBe(referents.length);
  });

  it('puts the baseplate top at y=0, which is what part coordinates are measured from', () => {
    expect(place).toContain('<X>0</X><Y>-2</Y><Z>0</Z>');
    expect(place).toContain('<Vector3 name="size"><X>512</X><Y>4</Y><Z>512</Z></Vector3>');
  });

  it('tags each part with its role so the scripts find it after a rename', () => {
    expect(place).toContain('<string name="Value">platform</string>');
    expect(place).toContain('<string name="Value">collectible</string>');
  });

  it('bootstraps the tags and the RemoteEvent before any generated gameplay runs', () => {
    const bootstrapAt = place.indexOf('CollectionService:AddTag');
    const gameplayAt = place.indexOf('Generated gameplay');
    expect(bootstrapAt).toBeGreaterThan(-1);
    expect(gameplayAt).toBeGreaterThan(bootstrapAt);
    expect(place).toContain('event.Name = "GameEvent"');
  });

  it('survives a script containing the CDATA terminator', () => {
    const tricky = readRobloxSpec({
      name: 'Nested',
      summary: '',
      spawnX: 0, spawnY: 4, spawnZ: 0,
      baseplateColor: '#4f7942',
      parts: [{ name: 'P', x: 0, y: 1, z: 0, width: 4, height: 1, depth: 4, color: '#ffffff', anchored: true, role: 'platform' }],
      // Valid Luau that contains `]]>` — it would otherwise close the CDATA
      // section early and truncate the whole file.
      serverScript: 'local t = {{1}}\nlocal v = t[1][1]\nprint(v, "a]]>b")\nprint("more than forty characters here")',
      clientScript: '',
    })!;
    const xml = rbxlxFromSpec(tricky);
    expect(xml).toContain(']]]]><![CDATA[>');
    expect(xml.trimEnd().endsWith('</roblox>')).toBe(true);
    // Every opened CDATA section is closed.
    expect((xml.match(/<!\[CDATA\[/g) ?? []).length).toBe((xml.match(/\]\]>/g) ?? []).length);
  });

  it('escapes a part name that would otherwise break the XML', () => {
    const hostile = readRobloxSpec({
      name: 'X', summary: '', spawnX: 0, spawnY: 4, spawnZ: 0, baseplateColor: '#4f7942',
      parts: [{ name: '</string><Item class="Evil"/>', x: 0, y: 1, z: 0, width: 4, height: 1, depth: 4, color: '#ffffff', anchored: true, role: 'decor' }],
      serverScript: 'print("a server script that is comfortably over forty characters")',
      clientScript: '',
    })!;
    expect(rbxlxFromSpec(hostile)).not.toContain('class="Evil"');
  });

  it('makes collectibles and hazards walk-through, and everything else solid', () => {
    const parts = place.split('<Item class="Part"');
    const coin = parts.find((part) => part.includes('>Coin<'))!;
    const ledge = parts.find((part) => part.includes('>Ledge<'))!;
    expect(coin).toContain('<bool name="CanCollide">false</bool>');
    expect(ledge).toContain('<bool name="CanCollide">true</bool>');
  });

  /**
   * The place is the ONLY record of the world — the spec is thrown away once the
   * file exists. So the browser plays a place by reading it back, and this is
   * the round trip that has to hold: what the writer emits is what the reader
   * gets. Both halves are asserted separately in their own suites; this is the
   * one test that puts them together, and it is here rather than in the frontend
   * because this is where the WRITER lives.
   */
  it('reads back as the same world it was written from', () => {
    const reading = robloxWorldReading(place)!;
    expect(reading.partCount).toBe(spec.parts.length);
    expect(reading.collectibles).toBe(1);

    const ledge = reading.scene.props.find((prop) => prop.kind === 'platform')!;
    expect(ledge.position).toEqual([1 * STUDS_TO_UNITS, 6 * STUDS_TO_UNITS, 10 * STUDS_TO_UNITS]);
    expect(ledge.scale).toEqual([12 * STUDS_TO_UNITS, 1 * STUDS_TO_UNITS, 6 * STUDS_TO_UNITS]);
    expect(ledge.color).toBe('#ff0000');
    expect(ledge.physics).toBe('static');

    // The baseplate is the ground, and its top face is the floor the parts'
    // y coordinates are measured from — so it must not come back as a prop.
    expect(reading.scene.props.some((prop) => prop.color === '#4f7942')).toBe(false);
    expect(reading.scene.ground.color).toBe('#4f7942');

    // And the rules come back as source, bootstrap included.
    const scripts = robloxScriptsFrom(place);
    expect(scripts.map((script) => script.name)).toEqual(['GameServer', 'GameClient']);
    expect(scripts[0]!.source).toContain('print("rules")');
    expect(scripts[0]!.source).toContain('CollectionService:AddTag');
  });
});

describe('the Rojo project', () => {
  const spec: RobloxGameSpec = readRobloxSpec({
    name: 'Tower Climb', summary: '', spawnX: 0, spawnY: 4, spawnZ: 0, baseplateColor: '#4f7942',
    parts: [{ name: 'Ledge', x: 1, y: 6, z: 10, width: 12, height: 1, depth: 6, color: '#ff0000', anchored: true, role: 'platform' }],
    serverScript: 'print("a server script that is comfortably over forty characters")',
    clientScript: '',
  })!;

  it('points at files the place generator actually emits', () => {
    const project = JSON.parse(rojoProjectJson('tower-climb'));
    const paths = JSON.stringify(project);
    expect(paths).toContain('src/server/GameServer.server.luau');
    expect(paths).toContain('src/server/World.server.luau');
    expect(paths).toContain('src/client/GameClient.client.luau');
  });

  it('builds the same world in Luau that the place builds in XML', () => {
    const world = worldBuilderLuau(spec);
    expect(world).toContain('Vector3.new(1, 6, 10)');
    expect(world).toContain('Vector3.new(12, 1, 6)');
    expect(world).toContain('Color3.fromHex("#ff0000")');
    expect(world).toContain('CollectionService:AddTag(part, "bf_" .. spec.role)');
  });

  it('escapes a part name that would otherwise break out of the Luau string', () => {
    const hostile = readRobloxSpec({
      name: 'X', summary: '', spawnX: 0, spawnY: 4, spawnZ: 0, baseplateColor: '#4f7942',
      parts: [{ name: 'a" }, os.exit() --', x: 0, y: 1, z: 0, width: 4, height: 1, depth: 4, color: '#ffffff', anchored: true, role: 'decor' }],
      serverScript: 'print("a server script that is comfortably over forty characters")',
      clientScript: '',
    })!;
    expect(worldBuilderLuau(hostile)).toContain('\\" }, os.exit() --');
  });

  it('gives the Rojo server script the same bootstrap the place has', () => {
    expect(serverScriptLuau(spec)).toContain('CollectionService:AddTag');
    expect(serverScriptLuau(spec)).toContain('print("a server script');
  });

  it('supplies a client script when the model wrote none, so the place has no empty LocalScript', () => {
    expect(clientScriptLuau(spec)).toContain('GameEvent');
  });
});

describe('Roblox publish targets', () => {
  it('accepts a pair of numeric ids', () => {
    expect(readPublishTarget('123', '456')).toEqual({ universeId: '123', placeId: '456' });
  });

  it('rejects a pasted URL, which is the common mistake', () => {
    expect(readPublishTarget('https://create.roblox.com/dashboard/creations/experiences/123', '456')).toBeNull();
    expect(readPublishTarget('123', '')).toBeNull();
  });
});

describe('the target catalogue', () => {
  it('registers every target exactly once, resolvable by its key', () => {
    const keys = GAME_TARGET_LIST.map((target) => target.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(resolveGameTarget(key)?.key).toBe(key);
    expect(resolveGameTarget('nintendo')).toBeNull();
  });

  it('keeps every target under its own game directory', () => {
    for (const target of GAME_TARGET_LIST) {
      expect(target.directory('space-blaster')).toMatch(/^games\/space-blaster\//);
    }
  });

  it('has the two native targets share ONE project directory', () => {
    // They are the same Capacitor app built by two runners. Separate directories
    // would give the author two copies of one app to keep in sync.
    expect(androidTarget.directory('space-blaster')).toBe(iosTarget.directory('space-blaster'));
  });

  it('materialises every model-free target without a generator', async () => {
    const modelFree = GAME_TARGET_LIST.filter((target) => target.key !== 'roblox');
    for (const target of modelFree) {
      const result = await target.materialize(context());
      expect(Object.keys(result.files).length).toBeGreaterThan(0);
      expect(result.detail).toBeTruthy();
    }
  });

  it('emits only relative paths in files, so the PWA can publish to a site root', async () => {
    for (const target of GAME_TARGET_LIST.filter((t) => t.key !== 'roblox')) {
      const result = await target.materialize(context());
      for (const path of [...Object.keys(result.files), ...Object.keys(result.binaryFiles ?? {})]) {
        expect(path.startsWith('/')).toBe(false);
        expect(path).not.toContain('..');
      }
    }
  });
});

describe('the phone targets', () => {
  it('publishes a manifest a phone will install from', async () => {
    const result = await pwaTarget.materialize(context({ siteUrl: 'https://space-blaster.builderforce.ai' }));
    const manifest = JSON.parse(result.files['manifest.webmanifest']!);
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true);
    expect(result.binaryFiles?.['icons/icon-512.png']).toBeInstanceOf(Uint8Array);
  });

  it('gives iOS the tags it reads instead of the manifest it ignores', async () => {
    const result = await pwaTarget.materialize(context());
    const html = result.files['index.html']!;
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  it('registers a service worker whose cache is versioned by the game itself', async () => {
    const result = await pwaTarget.materialize(context());
    expect(result.files['index.html']).toContain("navigator.serviceWorker.register('./sw.js')");
    expect(result.files['sw.js']).toContain(`const CACHE = 'space-blaster-v${PLAYABLE.length}'`);
    expect(result.files['sw.js']).not.toContain('__BUILD__');
  });

  it('blocks on publishing before it has an address, and on installing after', async () => {
    const before = await pwaTarget.materialize(context());
    expect(before.setupSteps.some((step) => step.key === 'publish' && step.blocking)).toBe(true);
    expect(before.playUrl).toBeNull();

    const after = await pwaTarget.materialize(context({ siteUrl: 'https://space-blaster.builderforce.ai' }));
    expect(after.setupSteps.every((step) => !step.blocking)).toBe(true);
    expect(after.playUrl).toBe('https://space-blaster.builderforce.ai');
  });

  it('ships the game unchanged on the web target, so every other target is the same bytes', async () => {
    const result = await webTarget.materialize(context());
    expect(result.files['index.html']).toBe(PLAYABLE);
  });
});

describe('the native build', () => {
  it('writes BOTH workflows from either native target, at the only path CI reads', async () => {
    const android = await androidTarget.materialize(context());
    const ios = await iosTarget.materialize(context());
    for (const result of [android, ios]) {
      expect(Object.keys(result.rootFiles ?? {}).sort()).toEqual([
        '.github/workflows/space-blaster-android.yml',
        '.github/workflows/space-blaster-ios.yml',
      ]);
    }
    // Materialising the other target must not rewrite the first one's CI.
    expect(android.rootFiles).toEqual(ios.rootFiles);
    expect(android.rootFiles).toEqual(capacitorWorkflowFiles(context()));
  });

  it('does not commit the native directories, which are generated per build', async () => {
    const result = await androidTarget.materialize(context());
    expect(result.files['.gitignore']).toContain('android/');
    expect(result.files['.gitignore']).toContain('ios/');
  });

  it('builds the APK with the JDK Capacitor 7 needs', async () => {
    const workflow = (await androidTarget.materialize(context())).rootFiles!['.github/workflows/space-blaster-android.yml']!;
    expect(workflow).toContain("java-version: '21'");
    expect(workflow).toContain('./gradlew assembleDebug');
    expect(workflow).toContain('if-no-files-found: error');
  });

  it('names iOS signing as blocking only for the .ipa, never for the simulator build', async () => {
    const unsigned = await iosTarget.materialize(context());
    expect(unsigned.setupSteps.some((step) => step.key === 'secret:IOS_CERTIFICATE_P12')).toBe(true);
    expect(unsigned.detail).toMatch(/simulator/i);

    const signed = await iosTarget.materialize(
      context({ secretNames: ['IOS_CERTIFICATE_P12', 'IOS_CERTIFICATE_PASSWORD', 'IOS_PROVISIONING_PROFILE'] }),
    );
    expect(signed.setupSteps.some((step) => step.key.startsWith('secret:'))).toBe(false);
    expect(signed.detail).toMatch(/\.ipa/);
  });

  it('points at the shared project directory from both workflows', async () => {
    const workflows = capacitorWorkflowFiles(context());
    for (const workflow of Object.values(workflows)) {
      expect(workflow).toContain('working-directory: games/space-blaster/app');
    }
  });

  it('wraps the touch-adapted game, not the bare document', async () => {
    const result = await androidTarget.materialize(context());
    expect(result.files['www/index.html']).toContain('id="bf-pad"');
    expect(JSON.parse(result.files['capacitor.config.json']!).appId).toBe('ai.builderforce.game.space_blaster');
  });
});

describe('the Roblox target', () => {
  it('refuses to invent a place when no generator is available', async () => {
    await expect(robloxTarget.materialize(context())).rejects.toThrow(/generator/i);
  });

  it('authors, evaluates and documents a place when one is', async () => {
    const spec = {
      name: 'Tower Climb',
      summary: 'Climb the tower and reach the top.',
      spawnX: 0, spawnY: 4, spawnZ: 0,
      baseplateColor: '#4f7942',
      parts: [
        { name: 'Ledge', x: 0, y: 6, z: 10, width: 12, height: 1, depth: 6, color: '#c0c0c0', anchored: true, role: 'platform' },
        { name: 'Coin', x: 0, y: 8, z: 10, width: 2, height: 2, depth: 2, color: '#ffd700', anchored: true, role: 'collectible' },
      ],
      serverScript: 'print("a server script that is comfortably over forty characters long")',
      clientScript: 'print("hud")',
    };
    const result = await robloxTarget.materialize(context({ compose: async () => spec }));
    expect(result.files['space-blaster.rbxlx']).toMatch(/^<roblox /);
    expect(result.files['default.project.json']).toBeTruthy();
    expect(result.detail).toContain('2 built parts');
    // The README's tag table is what tells the developer how the world and the
    // scripts are connected; an empty one means the place is unmaintainable.
    expect(result.files['README.md']).toContain('`bf_collectible`');
  });

  it('rejects an empty world rather than shipping a place that opens to nothing', async () => {
    await expect(
      robloxTarget.materialize(context({ compose: async () => ({ parts: [], serverScript: '' }) })),
    ).rejects.toThrow(/no buildable parts|no server script/i);
  });

  it('makes creating the experience blocking, because Open Cloud cannot do it', async () => {
    const spec = {
      name: 'T', summary: '', spawnX: 0, spawnY: 4, spawnZ: 0, baseplateColor: '#4f7942',
      parts: [{ name: 'P', x: 0, y: 1, z: 0, width: 4, height: 1, depth: 4, color: '#ffffff', anchored: true, role: 'platform' }],
      serverScript: 'print("a server script that is comfortably over forty characters long")',
      clientScript: '',
    };
    const result = await robloxTarget.materialize(context({ compose: async () => spec }));
    const blocking = result.setupSteps.filter((step) => step.blocking).map((step) => step.key);
    expect(blocking).toContain('roblox:experience');
    expect(blocking).toContain('secret:ROBLOX_API_KEY');
  });
});

describe('buildGame', () => {
  it('normalises and accepts a playable document', () => {
    const built = buildGame({ title: 'Space Blaster', brief: 'Shoot things', html: PLAYABLE });
    expect(built.ok).toBe(true);
    expect(built.ok && built.game.slug).toBe('space-blaster');
    expect(built.ok && built.game.accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('refuses a document that would ship a blank screen to a phone', () => {
    const built = buildGame({ title: 'Broken', brief: 'x', html: '<!doctype html><p>Coming soon</p>' });
    expect(built.ok).toBe(false);
  });

  it('falls back to the title when the brief is empty, so a target never has no context', () => {
    const built = buildGame({ title: 'Space Blaster', brief: '   ', html: PLAYABLE });
    expect(built.ok && built.game.brief).toBe('Space Blaster');
  });
});

/**
 * The routing contract, which is where this feature actually broke.
 *
 * Everything else in this file tested the machinery that ships a game. None of it
 * tested the path a person takes to ASK for one — so "create a Roblox game"
 * reached `canvas_add_object`, satisfied the empty-shell gate with a four-
 * thousand-word design document, and produced an object with no artifact behind
 * it (operator report 2026-08-17, ui 2026.8.49). These are the assertions that
 * would have caught it.
 */
describe('asking for a game routes to the tool that builds one', () => {
  it('advertises exactly one tool that produces a playable game', () => {
    expect(CANVAS_GAME_TOOL).toBe('canvas_add_game');
    expect(CREATION_CANVAS_TOOLS).toContain(CANVAS_GAME_TOOL);
  });

  it('offers it to guests, because an absent tool is answered with an invented refusal', () => {
    // A guest asking for a game otherwise falls through to `canvas_add_object`,
    // which is the exact route that produced a design document.
    expect(GUEST_GATED_CANVAS_TOOLS).toContain(CANVAS_GAME_TOOL);
  });

  it('names the tool that works, instead of describing the schema that does not', () => {
    const redirect = canvasGameToolRedirect();
    expect(redirect).toContain(CANVAS_GAME_TOOL);
    // The refusal this replaces listed `content` first, which is precisely how a
    // model was taught to write prose into a game.
    expect(redirect).toMatch(/design document is NOT a game/i);
  });

  it('tells the model a phone or app request is still a web game, not a refusal', () => {
    // "a game that ports to android" must not become a Roblox place, a design
    // document, or "I cannot do that" — it is one web document that installs.
    const redirect = canvasGameToolRedirect();
    expect(redirect).toMatch(/phone/i);
    expect(redirect).toMatch(/platform "web"/);
  });

  it('gates only the half that genuinely needs a server, and says what still works', () => {
    // A web game is authored in the visitor's own browser. Claiming otherwise
    // would be a false limitation — the failure mode the image gate exists for.
    expect(CANVAS_GAME_ACCOUNT_GATE).toMatch(/roblox/i);
    expect(CANVAS_GAME_ACCOUNT_GATE).toContain(CANVAS_GAME_TOOL);
    expect(CANVAS_GAME_ACCOUNT_GATE).toMatch(/cannot make games/i);
  });

  it('knows the two platforms that produce genuinely different artifacts', () => {
    expect([...GAME_PLATFORMS]).toEqual(['web', 'roblox']);
    expect(isGamePlatform('roblox')).toBe(true);
    expect(isGamePlatform('android')).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('closes every hole a title could open', () => {
    expect(escapeHtml(`<>&'"`)).toBe('&lt;&gt;&amp;&#39;&quot;');
  });
});
