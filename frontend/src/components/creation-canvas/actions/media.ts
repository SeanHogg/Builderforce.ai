/** Pictures, captures, games and rooms — the media a turn can put on the board. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { getStoredTenantToken } from '@/lib/auth';
import { accountGateResult } from './accountGate';
import { CANVAS_GAME_ACCOUNT_GATE, CANVAS_GAME_TOOL, CANVAS_IMAGE_ACCOUNT_GATE, CANVAS_IMAGE_TOOL, CANVAS_SCREENSHOT_ACCOUNT_GATE, CANVAS_SCREENSHOT_TOOL, CANVAS_VIEWPORTS, canvasScreenshotToolRedirect, canvasViewport, GAME_PLATFORMS, isGamePlatform, looksLikeWebPageUrl, ROOM_LAYOUT_CUSTOM, websiteBeforePatch } from '@builderforce/creation-canvas-contract';
import { type CanvasImageResolveMode, captureCanvasScreenshot, resolveCanvasImage } from '@/lib/canvasImageAssets';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import type { CreationNodeData } from '../types';
import { webPageHost } from '@/lib/canvasWebPage';
import { buildBrowserCreativeArtifact, type CreationDeliverable, type CreativeArtifact, generateServerCreativeArtifact, withCreationDeliverable } from '@/lib/creationDeliverables';
import { ROOM_CREATION_TOOL_NOTE, ROOM_DESIGN_TOOL_NOTE } from '@/lib/canvas/roomCreations';
import { buildTheaterRoomDesign, theaterRoomSummary } from '@/lib/canvas/roomAuthorship';
import type { CanvasActionContext } from './context';

export function canvasMediaActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, requireAccount, stage, stageImageAsset, t } = ctx;
  return [  {
    name: 'canvas_add_image',
    description: 'Find or create an actual image and put the finished image on the Canvas. ALWAYS use this instead of canvas_add_object for an image request. Use mode="generate" for create/draw/generate/make requests, mode="find" for find/search/stock/photo requests, and mode="auto" only when the user did not express a preference.',
    parameters: {
      type: 'object', required: ['query', 'mode'], additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'The complete visual search query or generation prompt.' },
        mode: { type: 'string', enum: ['find', 'generate', 'auto'] },
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      // ADVERTISED ON EVERY BOARD, EXECUTED WITH ANY ACCOUNT. Stripping this tool from
      // an anonymous canvas removed the only route to pixels, and a model cannot report
      // a tool it was never given — it improvises. See the guest-gated set in
      // `@builderforce/creation-canvas-contract`. Gated on CREDENTIALS, not on whether
      // the board is saved: search and generation are stateless posts that carry the
      // tenant token, so a signed-in user on an unsaved board gets real pixels. Read the
      // token here rather than closing over `hasAccount`, so a sign-in mid-session is
      // reflected on the very next call instead of on the next memo rebuild.
      if (!getStoredTenantToken()) {
        requireAccount('image', t('gateImageTitle'), t('gateImageBody'));
        return accountGateResult(CANVAS_IMAGE_TOOL, CANVAS_IMAGE_ACCOUNT_GATE);
      }
      const args = raw as { query?: string; mode?: CanvasImageResolveMode; title?: string; x?: number; y?: number };
      const query = typeof args.query === 'string' ? args.query.trim().slice(0, 2_000) : '';
      const mode = args.mode === 'find' || args.mode === 'generate' || args.mode === 'auto' ? args.mode : null;
      if (!query || !mode) return { error: 'Pass an image query and mode (find, generate, or auto)' };
      // "Find me a picture of https://example.com" is a request to photograph a page.
      if (looksLikeWebPageUrl(query)) return { error: canvasScreenshotToolRedirect() };
      try {
        const asset = await resolveCanvasImage(query, mode);
        const imageTitle = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 160) : query.slice(0, 80);
        const node = stageImageAsset(asset, { title: imageTitle, prompt: query, at: args });
        return { ok: true, proposed: true, object: { id: node.id, kind: 'image', title: node.data.title }, source: asset.source, provider: asset.provider, imageUrl: asset.url };
      } catch (error) {
        return { error: toolErrorMessage(error, 'The image could not be resolved') };
      }
    },
  },   {
    name: CANVAS_SCREENSHOT_TOOL,
    description: 'Photograph a LIVE web page and put the real screenshot on the Canvas. A real browser renders the page server-side, so this works on any public URL and on JS-rendered sites. ALWAYS use this for "screenshot", "show me the current site", "what does it look like now", or the BEFORE half of any redesign, audit or comparison — never say you cannot browse the web visually, cannot see a website, or cannot take screenshots. To build a before-and-after, capture the live page with compareWithObjectId set to the website or prototype object holding the new design: the capture is attached to that object as its "before" and the site opens on a side-by-side comparison. Without compareWithObjectId the screenshot lands as its own image object.',
    parameters: {
      type: 'object', required: ['url'], additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL of the page to photograph.' },
        compareWithObjectId: { type: 'string', description: 'Id of the website or prototype object this page is the BEFORE of. Attaches the capture to that design instead of creating a separate image object.' },
        viewport: { type: 'string', enum: [...CANVAS_VIEWPORTS], description: 'Device width to render at. Use the same one the new design is being judged at.' },
        fullPage: { type: 'boolean', description: 'Capture the whole scrollable page rather than the first screen. Default false.' },
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      // Gated on CREDENTIALS at CALL time, exactly like `canvas_add_image` and for the
      // same reason: the renderer is a real browser on the server, so a signed-in user
      // on an unsaved board gets real pixels, and a guest gets a true one-sentence
      // reason instead of the invented one this tool exists to stop.
      if (!getStoredTenantToken()) {
        requireAccount('image', t('gateScreenshotTitle'), t('gateScreenshotBody'));
        return accountGateResult(CANVAS_SCREENSHOT_TOOL, CANVAS_SCREENSHOT_ACCOUNT_GATE);
      }
      const args = raw as { url?: string; compareWithObjectId?: string; viewport?: string; fullPage?: boolean; title?: string; x?: number; y?: number };
      const url = typeof args.url === 'string' ? args.url.trim().slice(0, 2_000) : '';
      if (!url) return { error: 'Pass the absolute http(s) URL of the page to capture' };
      const viewport = canvasViewport(args.viewport);

      // Resolve the comparison target BEFORE spending a render: attaching a "before" to
      // an object that is not a site is a silent no-op the model would report as done.
      const targetId = typeof args.compareWithObjectId === 'string' ? args.compareWithObjectId.trim() : '';
      const target = targetId ? stage.nodes().find((node) => node.id === targetId) : undefined;
      if (targetId && !target) return { error: `No object with id ${targetId} is on this canvas` };
      if (target && target.data.kind !== 'website' && target.data.kind !== 'prototype') {
        return { error: `A before/after comparison belongs to a website or prototype object; ${targetId} is a "${target.data.kind}". Capture without compareWithObjectId to add the screenshot as its own image object.` };
      }

      try {
        const asset = await captureCanvasScreenshot(url, viewport, args.fullPage === true);
        if (target) {
          const patch = websiteBeforePatch({
            url: asset.capturedUrl ?? url,
            imageUrl: asset.url,
            ...(asset.capturedAt ? { capturedAt: asset.capturedAt } : {}),
            viewport: asset.capturedViewport ?? viewport,
            ...(asset.width ? { width: asset.width } : {}),
            ...(asset.height ? { height: asset.height } : {}),
          });
          stage.updateObject(t('screenshotComparisonProposal', { title: target.data.title }), target.id, patch as Partial<CreationNodeData>);
          return {
            ok: true, proposed: true, comparison: true,
            object: { id: target.id, kind: target.data.kind, title: target.data.title },
            capturedUrl: asset.capturedUrl ?? url, capturedAt: asset.capturedAt, viewport,
            note: `The capture is attached as this design's "before". Open the site object to read them side by side.`,
          };
        }
        const captureTitle = typeof args.title === 'string' && args.title.trim()
          ? args.title.trim().slice(0, 160)
          : t('screenshotDefaultTitle', { host: webPageHost(asset.capturedUrl ?? url) });
        const node = stageImageAsset(asset, { title: captureTitle, at: args });
        return {
          ok: true, proposed: true, object: { id: node.id, kind: 'image', title: node.data.title },
          source: asset.source, provider: asset.provider, capturedUrl: asset.capturedUrl ?? url, capturedAt: asset.capturedAt,
        };
      } catch (error) {
        // The service's message names the REAL reason (unconfigured / timed out / too
        // large). Relaying it verbatim is the entire contract — a generic failure is
        // what sends the model back to inventing a limitation of its own.
        return { error: toolErrorMessage(error, 'The page could not be captured') };
      }
    },
  },   {
    name: CANVAS_GAME_TOOL,
    description: 'Write a PLAYABLE game and put it on the Canvas, finished. ALWAYS use this instead of canvas_add_object for any request to make, build, create or design a game — including "a Roblox game", "a game for my phone", "an Android game" or "an iPhone game". It authors the game AND attaches the playable artifact in one call, so the user can press play immediately. A game design document is NOT a game: never write the concept into a `game` object as prose and never present a design as if it were playable. Use platform "roblox" when the user names Roblox, Studio, or an experience; otherwise use platform "web" — one self-contained document that plays on the canvas, installs on an Android or iPhone home screen, and wraps into a real app, so a phone or app-store request is still platform "web".',
    parameters: {
      type: 'object', required: ['brief', 'platform'], additionalProperties: false,
      properties: {
        brief: { type: 'string', description: 'What the game IS: the goal, the rules, how it is controlled, how you win or lose. Concrete and specific — this is the only description the generator gets.' },
        platform: { type: 'string', enum: [...GAME_PLATFORMS] },
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { brief?: string; platform?: string; title?: string; x?: number; y?: number };
      const brief = typeof args.brief === 'string' ? args.brief.trim().slice(0, 4_000) : '';
      const platform = isGamePlatform(args.platform) ? args.platform : null;
      if (!brief || !platform) return { error: `Pass a brief and a platform (${GAME_PLATFORMS.join(' or ')})` };

      // Gated on CREDENTIALS and only for Roblox, read at call time so a sign-in
      // mid-session counts on the very next turn — the same rule as the image
      // tool. A WEB game is authored in this browser and needs no account, so
      // gating the whole tool would be a false limitation.
      if (platform === 'roblox' && !getStoredTenantToken()) {
        requireAccount('game', t('game.gateTitle'), t('game.gateBody'));
        return accountGateResult(CANVAS_GAME_TOOL, CANVAS_GAME_ACCOUNT_GATE);
      }

      const node = stage.createObject('game', args);
      const gameTitle = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 160) : brief.slice(0, 60);
      const seed: CreationNodeData = { ...node.data, kind: 'game', title: gameTitle, prompt: brief, gamePlatform: platform };

      // The whole point of this tool: GENERATE, then attach. A game object that
      // reaches the board without an artifact is the bug this replaces.
      let artifact: CreativeArtifact;
      try {
        artifact = getStoredTenantToken()
          ? await generateServerCreativeArtifact(seed)
          : { ...buildBrowserCreativeArtifact(seed), provider: 'builderforce-browser' };
      } catch (error) {
        // Roblox has no browser baseline — a place cannot be authored without a
        // model — so its failure is reported rather than quietly downgraded into
        // an HTML game the user did not ask for.
        if (platform === 'roblox') {
          return { error: toolErrorMessage(error, 'The Roblox place could not be generated') };
        }
        artifact = { ...buildBrowserCreativeArtifact(seed), provider: 'builderforce-browser' };
      }

      const delivered: CreationDeliverable = {
        id: crypto.randomUUID(), action: 'generate', artifactKind: artifact.artifactKind,
        status: 'delivered', createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        url: artifact.url, mimeType: artifact.mimeType, fileName: artifact.fileName, provider: artifact.provider,
        validation: { status: 'passed', detail: artifact.validationDetail },
        metadata: { outputFormat: artifact.outputFormat, platform, ...(artifact.model ? { model: artifact.model } : {}) },
      };
      node.data = {
        ...seed,
        status: t('creativeGeneratedStatus'),
        ...(artifact.summary ? { subtitle: artifact.summary } : { subtitle: brief.slice(0, 160) }),
        outputUrl: artifact.url,
        outputFormat: artifact.outputFormat,
        outputFileName: artifact.fileName,
        outputMimeType: artifact.mimeType,
        provider: artifact.provider,
        thumbnailUrl: artifact.previewImageUrl ?? '',
        deliverables: withCreationDeliverable(node.data, delivered),
      };
      node.style = { width: 520, height: 470 };
      stage.addObject(t('game.proposal', { title: gameTitle }), node);
      return {
        ok: true, proposed: true, playable: true,
        object: { id: node.id, kind: 'game', title: gameTitle }, platform,
        provider: artifact.provider, outputFormat: artifact.outputFormat,
        instruction: platform === 'roblox'
          ? `${ROOM_CREATION_TOOL_NOTE} The place also downloads as a .rbxlx — say it opens in Roblox Studio and plays there. Do NOT restate the design as prose.`
          : `${ROOM_CREATION_TOOL_NOTE} It plays immediately — say so in one line. Do NOT restate the design as prose.`,
      };
    },
  },   {
    name: 'canvas_create_room',
    description: 'Build a theater-style room with seating for N people and put it on the canvas as the active room. ALWAYS prefer this over canvas_add_object for "a theater", "seating for N", "an auditorium" or similar — it places only valid furniture kinds (chairs facing a screen), sets roomDesign + layout custom + activatedAt, and never lands an empty black box. Doors, lights and podiums are not furniture kinds.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        seats: { type: 'number', description: 'How many people should fit. Clamped to a sensible theater range.' },
        title: { type: 'string', description: 'Room title, e.g. "Main theater".' },
        x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { seats?: number; title?: string; x?: number; y?: number; width?: number; height?: number };
      const design = buildTheaterRoomDesign(Number(args.seats));
      const summary = theaterRoomSummary(design);
      const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim().slice(0, 160) : `Theater (${summary.seats})`;
      const node = stage.createObject('room', {
        ...(args.x != null ? { x: args.x } : {}),
        ...(args.y != null ? { y: args.y } : {}),
      });
      node.data = {
        ...node.data,
        title,
        status: 'Ready',
        roomLayout: ROOM_LAYOUT_CUSTOM,
        roomDesign: design,
        activatedAt: new Date().toISOString(),
      };
      const width = Number(args.width); const height = Number(args.height);
      if (Number.isFinite(width) || Number.isFinite(height)) {
        node.style = {
          width: Number.isFinite(width) ? Math.max(240, Math.min(width, 2_400)) : undefined,
          height: Number.isFinite(height) ? Math.max(130, Math.min(height, 1_800)) : undefined,
        };
      }
      stage.addObject(`Add room “${title}”`, node);
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'room', title },
        seats: summary.seats, pieces: summary.pieces, area: summary.area,
        instruction: ROOM_DESIGN_TOOL_NOTE,
      };
    },
  }];
}
