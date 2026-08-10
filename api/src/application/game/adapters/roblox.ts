/**
 * `roblox` — the brief, re-authored as a Roblox experience.
 *
 * The only target that does not ship the generated HTML, because Roblox does not
 * run HTML. See `robloxPlace.ts` for why the world is a spec and the scripts are
 * source; this adapter is the wiring around that: call the model, evaluate the
 * spec into a place, and emit both artifacts a Roblox developer actually uses —
 * a `.rbxlx` you double-click, and a Rojo project you develop in.
 *
 * Publishing is a separate, explicit step (`robloxCloud.ts`) rather than part of
 * materialising, because it OVERWRITES a live experience. Regenerating a game
 * should never silently replace what other people are currently playing.
 */

import type { GameTarget, GameTargetContext, GameTargetResult } from '../gameTarget';
import { missingGameSecretSteps } from '../gameTarget';
import { ROBLOX_SECRETS } from '../robloxCloud';
import {
  ROBLOX_RESPONSE_SCHEMA,
  ROBLOX_SYSTEM_PROMPT,
  clientScriptLuau,
  rbxlxFromSpec,
  readRobloxSpec,
  rojoProjectJson,
  serverScriptLuau,
  worldBuilderLuau,
  type RobloxGameSpec,
} from '../robloxPlace';

const MAX_TOKENS = 8000;

/** Thrown so the route can answer 502 with the reason rather than a generic failure. */
export class RobloxAuthoringError extends Error {}

/** Author a place spec from the brief. Exported so the route can reuse it on publish. */
export async function authorRobloxSpec(ctx: GameTargetContext): Promise<RobloxGameSpec> {
  if (!ctx.compose) {
    throw new RobloxAuthoringError('No generator is available to author a Roblox place.');
  }
  const { game } = ctx;
  const raw = await ctx.compose({
    system: ROBLOX_SYSTEM_PROMPT,
    user: `Title: ${game.title}\nBrief: ${game.brief}`,
    schema: ROBLOX_RESPONSE_SCHEMA,
    maxTokens: MAX_TOKENS,
    useCase: 'game_roblox',
  });
  const spec = readRobloxSpec(raw);
  if (!spec) {
    throw new RobloxAuthoringError(
      'The generated Roblox place had no buildable parts or no server script, so it would open empty.',
    );
  }
  return spec;
}

/** Every file a place produces. Shared by materialise and by publish. */
export function robloxFiles(spec: RobloxGameSpec, slug: string): Record<string, string> {
  return {
    [`${slug}.rbxlx`]: rbxlxFromSpec(spec),
    'default.project.json': rojoProjectJson(slug),
    'src/server/World.server.luau': worldBuilderLuau(spec),
    'src/server/GameServer.server.luau': serverScriptLuau(spec),
    'src/client/GameClient.client.luau': clientScriptLuau(spec),
    'README.md': renderReadme(spec, slug),
  };
}

function renderReadme(spec: RobloxGameSpec, slug: string): string {
  const roles = spec.parts.reduce<Record<string, number>>((counts, part) => {
    counts[part.role] = (counts[part.role] ?? 0) + 1;
    return counts;
  }, {});
  const inventory = Object.entries(roles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, count]) => `| \`bf_${role}\` | ${count} |`)
    .join('\n');

  return `# ${spec.name} — Roblox

${spec.summary}

## Play it in a minute

1. Download \`${slug}.rbxlx\`.
2. Double-click it, or open Roblox Studio → **File → Open** and pick it.
3. Press **Play**.

That is a complete place: baseplate, spawn, ${spec.parts.length} built parts, a server
script that owns the rules and a client script that draws the UI.

## Publish it

**From Studio** — File → Publish to Roblox As. This creates the experience the
first time, and is the only way to create one; Roblox has no API for it.

**From Builderforce** — once the experience exists, paste its Universe ID and
Place ID into the game's Roblox panel and add a \`ROBLOX_API_KEY\` project secret.
Every regeneration then publishes straight to the live place.

Both ids are in the Creator Dashboard URL for your experience:
\`create.roblox.com/dashboard/creations/experiences/<UNIVERSE_ID>/places/<PLACE_ID>\`

## How the world and the scripts are connected

Parts are tagged, not named — rename anything in Studio and the gameplay still
finds it. The server bootstrap converts each part's \`bf_role\` marker into a real
\`CollectionService\` tag before any gameplay runs.

| Tag | Parts |
| --- | --- |
${inventory}

Read them with \`CollectionService:GetTagged("bf_collectible")\`, and so on.

Server and client talk over \`ReplicatedStorage.GameEvent\`, a \`RemoteEvent\` the
bootstrap creates. Score is a \`leaderstats\` \`IntValue\` named \`Score\`, so it shows
in the player list with no extra work.

## Developing it properly

The \`.rbxlx\` is the artifact; the Rojo project is the source.

\`\`\`bash
rojo serve          # then connect from the Rojo plugin in Studio
rojo build -o ${slug}.rbxlx
\`\`\`

\`src/server/World.server.luau\` builds the same world as a data table — edit the
table and the level changes in a diff, which a binary place file cannot give you.
`;
}

export const robloxTarget: GameTarget = {
  key: 'roblox',
  label: 'Roblox experience',
  summary:
    'Re-authors the brief as a real Roblox place in Luau — a .rbxlx you open in Studio, plus a Rojo '
    + 'project. Publishes straight to a live experience once its ids and an API key are set.',
  zeroSetup: false,
  device: 'roblox',
  directory: (slug) => `games/${slug}/roblox`,
  async materialize(ctx: GameTargetContext): Promise<GameTargetResult> {
    const spec = await authorRobloxSpec(ctx);
    const files = robloxFiles(spec, ctx.game.slug);

    return {
      files,
      setupSteps: [
        {
          key: 'roblox:studio',
          label: 'Open the place in Roblox Studio and press Play',
          detail:
            `Download ${ctx.game.slug}.rbxlx and open it. Nothing else is needed to play it — `
            + 'the place is complete, with the world built and both scripts in place.',
          blocking: false,
        },
        {
          key: 'roblox:experience',
          label: 'Create the experience once, from Studio',
          detail:
            'Roblox Open Cloud can replace a place but cannot create an experience, so the first publish '
            + 'has to be File → Publish to Roblox As. After that, every regeneration can publish itself.',
          url: 'https://create.roblox.com/dashboard/creations',
          blocking: true,
        },
        ...missingGameSecretSteps(ctx, ROBLOX_SECRETS),
        {
          key: 'roblox:ids',
          label: 'Paste the Universe ID and Place ID',
          detail:
            'Both are in the Creator Dashboard URL for your experience. They tell the publish which place '
            + 'to overwrite; without them there is nothing to publish to.',
          blocking: true,
        },
      ],
      playUrl: null,
      detail:
        `Roblox place with ${spec.parts.length} built part${spec.parts.length === 1 ? '' : 's'}, `
        + 'a server ruleset and a client HUD, plus a Rojo project',
    };
  },
};
