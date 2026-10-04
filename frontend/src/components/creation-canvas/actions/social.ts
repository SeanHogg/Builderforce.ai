/** Social accounts, feeds and campaigns — connect, read, pin, draft and publish. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { socialApi, type SocialFeedFilter, type SocialFeedItem, type SocialNetwork, totalEngagement } from '@/lib/socialApi';
import { isSocialNetworkName, socialCampaignNodeData, socialFeedPatch, socialPostNodeData, socialPostProjection } from '@/lib/canvasSocial';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { canvasMediaSource, describePublicMediaProblem, resolvePublicMediaUrls } from '@/lib/canvasPublicMedia';
import type { CanvasActionContext } from './context';

export function canvasSocialActions(ctx: CanvasActionContext): BrainAction[] {
  const { buildSocialFeedNode, canEdit, persistence, sessionId, setDockPanel, socialAccountGate, stage, tSocial } = ctx;
  return [  {
    /**
     * "Connect all my social accounts" — the FIRST thing anyone asks for, and until
     * now the one thing the social vocabulary could not answer.
     *
     * Every other social tool assumes accounts already exist. Asked to connect them,
     * the model had nothing to call and improvised (2026-08-15, see the note in
     * `@builderforce/creation-canvas-contract`): it told the user to go and connect
     * their accounts to "a social media management platform" — while sitting inside
     * one, one rail icon away from the panel that does it.
     *
     * It does NOT take credentials. A token typed into a chat message is a token
     * written into the conversation, the timeline, the diagnostics report and the
     * model's context; the connect form is where a secret belongs, and this opens it.
     * What the tool returns is the thing the model actually lacked — which networks
     * exist, which are already connected, and exactly what each still needs — so the
     * reply is a specific instruction rather than a suggestion to look around.
     */
    name: 'canvas_connect_social_account',
    description: 'Open the social panel on this canvas so the user can CONNECT their X, LinkedIn, Facebook Pages, Instagram or TikTok account, and return which networks are available, which are already connected, and what each one still needs before it can publish. Call this whenever the user asks to connect, link, add, hook up or authorise their social accounts, and whenever another social tool reports that no account is connected. This does not ask you for credentials and you must never request a password, token or API key in chat — the panel collects them securely. Relay the returned per-network requirements verbatim.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { network: { type: 'string', description: 'Highlight one network: x, linkedin, facebook, instagram or tiktok. Omit to show them all.' } },
    },
    mutates: false,
    run: async (raw: unknown) => {
      const gated = socialAccountGate('canvas_connect_social_account');
      if (gated) return gated;
      const wanted = (raw as { network?: string }).network;
      let networks: Awaited<ReturnType<typeof socialApi.networks>>;
      let accounts: Awaited<ReturnType<typeof socialApi.accounts>>;
      try {
        [networks, accounts] = await Promise.all([socialApi.networks(), socialApi.accounts()]);
      } catch (error) {
        return { error: error instanceof Error ? error.message : tSocial('loadFailed') };
      }
      // Opening the panel IS the action — the tool has done its work by the time the
      // model reads this, which is why it reports `opened` rather than proposing a
      // change the user would have to approve before anything appeared.
      setDockPanel('social');
      const listed = networks.networks.filter((option) => !isSocialNetworkName(wanted) || option.network === wanted);
      return {
        ok: true,
        opened: true,
        instruction: 'The social panel is open on this canvas, on its Accounts tab. Tell the user to pick their network there and complete the connect form — never ask them for a credential in chat.',
        networks: listed.map((option) => ({
          network: option.network,
          label: option.label,
          connected: option.connectedCount,
          publishMode: option.publishMode,
          // The non-secret ids three networks cannot post without. Naming them up
          // front is what stops a connection that looks fine from failing at publish.
          alsoNeeds: option.accountFields.map((field) => `${field.label} — ${field.help}`),
        })),
        connected: accounts.accounts.map((account) => ({
          network: account.network,
          name: account.name,
          ready: account.ready,
          missing: account.missingFields.map((field) => field.label),
        })),
      };
    },
  },   {
    /**
     * "Show me our social feed" — the whole point of a connected account on the board.
     *
     * A dedicated action rather than `canvas_add_object` with authored fields, for the
     * same reason `canvas_add_inbox` is: a model cannot invent what a company actually
     * posted or how it performed. This READS the connected accounts and puts what is
     * really there on the board, and it stores the FILTER alongside the posts, which is
     * what makes the tile a live, reproducible view rather than a screenshot.
     */
    name: 'canvas_add_social_feed',
    description: 'Put a LIVE SOCIAL FEED from the workspace\'s connected accounts (X, LinkedIn, Facebook, Instagram, TikTok) onto the canvas, merged newest-first with real engagement numbers. Use this whenever the user asks to see, show, review or analyse their social media, posts, or channel performance — it reads their real accounts rather than inventing posts. Narrow with networks (e.g. ["x","linkedin"]) or query (free text). The filter is saved with the tile so it can be refreshed later and still mean the same thing.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        networks: { type: 'array', items: { type: 'string' }, description: 'Restrict to these networks: x, linkedin, facebook, instagram, tiktok.' },
        title: { type: 'string', description: 'Tile title, e.g. "Launch week posts". Defaults to a description of the filter.' },
        query: { type: 'string', description: 'Free-text filter across post text and author.' },
        limit: { type: 'number', description: 'Up to 50. Defaults to 25.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = socialAccountGate('canvas_add_social_feed');
      if (gated) return gated;
      const args = raw as { networks?: string[]; title?: string; query?: string; limit?: number; x?: number; y?: number };
      const filter: SocialFeedFilter = {
        ...(Array.isArray(args.networks) && args.networks.length ? { networks: args.networks.filter(isSocialNetworkName) } : {}),
        ...(args.query ? { q: args.query } : {}),
        ...(args.limit ? { limit: args.limit } : {}),
      };
      const built = await buildSocialFeedNode(filter, {
        ...(args.title ? { title: args.title } : {}),
        ...(args.x != null ? { x: args.x } : {}),
        ...(args.y != null ? { y: args.y } : {}),
      });
      if (!built.ok) return { error: built.error };
      stage.addObject(`Add social feed “${built.node.data.title}”`, built.node);
      return {
        ok: true, proposed: true,
        object: { id: built.node.id, kind: 'socialFeed', title: built.node.data.title },
        accounts: built.read.accounts.map((account) => `${account.networkLabel} · ${account.name}`),
        total: built.read.items.length,
        engagement: totalEngagement(built.read.items),
        posts: built.read.items.map(socialPostProjection),
        ...(built.read.errors.length ? { accountErrors: built.read.errors } : {}),
      };
    },
  },   {
    name: 'canvas_refresh_social_feed',
    description: 'Re-read the social accounts behind a feed already on the canvas, using the filter that tile was created with, and return what is there now. Use this when asked to refresh, re-check or "look again at" a social feed on the board — it updates the tile in place rather than adding a second one.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'The social feed object. Omit when the canvas holds exactly one.' } },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = socialAccountGate('canvas_refresh_social_feed');
      if (gated) return gated;
      const objectId = (raw as { objectId?: string }).objectId;
      const feeds = ctx.nodes().filter((node) => node.data.kind === 'socialFeed');
      const target = objectId ? feeds.find((node) => node.id === objectId) : feeds.length === 1 ? feeds[0] : undefined;
      if (!target) return { error: feeds.length ? 'Say which social feed to refresh.' : 'There is no social feed on this canvas yet.' };

      let read: Awaited<ReturnType<typeof socialApi.feed>>;
      try {
        read = await socialApi.feed((target.data.filter as SocialFeedFilter) ?? {});
      } catch (error) {
        return { error: toolErrorMessage(error, 'Those accounts could not be read.') };
      }
      const patch = socialFeedPatch(read);
      stage.updateObject(`Refresh social feed ${target.id}`, target.id, patch);
      return {
        ok: true, proposed: true, objectId: target.id,
        total: read.items.length, engagement: totalEngagement(read.items),
        posts: read.items.map(socialPostProjection),
        ...(read.errors.length ? { accountErrors: read.errors } : {}),
      };
    },
  },   {
    /** Lifting one post out of a live view is what makes it durable: a `socialPost`
     *  object stops changing, so it can be annotated, connected to a task, and
     *  compared against whatever was published after it. */
    name: 'canvas_pin_social_post',
    description: 'Pin ONE post from a social feed on the canvas as its own object, with its text, media and engagement at the time it was read. Use this when a specific post needs to be discussed, annotated, or connected to work — unlike the live feed tile, a pinned post does not change when the account does.',
    parameters: {
      type: 'object', required: ['postId'], additionalProperties: false,
      properties: {
        postId: { type: 'string', description: 'The post id, as listed by the feed tile.' },
        objectId: { type: 'string', description: 'Which feed it came from. Omit when the canvas holds exactly one.' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { postId?: string; objectId?: string };
      const feeds = ctx.nodes().filter((node) => node.data.kind === 'socialFeed');
      const source = args.objectId ? feeds.find((node) => node.id === args.objectId) : feeds.length === 1 ? feeds[0] : undefined;
      if (!source) return { error: feeds.length ? 'Say which social feed the post is in.' : 'There is no social feed on this canvas yet.' };

      const posts = (Array.isArray(source.data.posts) ? source.data.posts : []) as SocialFeedItem[];
      const post = posts.find((item) => String(item.id) === String(args.postId));
      if (!post) return { error: 'That post is not in this feed — refresh it, or pin one of the posts it lists.' };

      const node = stage.createObject('socialPost', { x: source.position.x + 500, y: source.position.y });
      node.data = { ...node.data, ...socialPostNodeData(post) };
      node.style = { width: 420, height: 420 };
      stage.addObject(`Pin ${post.network} post`, node);
      stage.addConnection(
        `Connect ${source.data.title} to the pinned post`,
        { id: crypto.randomUUID(), source: source.id, target: node.id, type: 'smoothstep', animated: false, label: 'pinned from', data: { connectionKind: 'reference' } },
      );
      return { ok: true, proposed: true, object: { id: node.id, kind: 'socialPost', title: node.data.title }, post: socialPostProjection(post) };
    },
  },   {
    /**
     * Drafting is separate from publishing, deliberately.
     *
     * A campaign object on the board is reviewable — its copy, its targets and its
     * blockers are visible — and `canvas_publish_social_campaign` is the single,
     * explicit act that makes it public. Collapsing the two would mean a model could
     * post to a company's channels as a side effect of being asked to "write" a post.
     */
    name: 'canvas_create_social_campaign',
    description: 'Draft a SOCIAL CAMPAIGN on the canvas — one announcement to be published to every connected account. This does NOT publish it; the tile shows the copy, each target account and any blockers, and canvas_publish_social_campaign is what makes it public. Use `variants` for per-network copy ({"x":"280 characters","linkedin":"a paragraph"}); an absent network falls back to `body`. Instagram cannot publish text alone: attach the picture with `mediaObjectIds` (canvas objects — the image this board already made) or `mediaUrls` (public https), or that account is skipped. Pass `scheduledAt` (ISO) to publish it later automatically.',
    parameters: {
      type: 'object', required: ['name', 'body'], additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Campaign name, for the board and the report.' },
        body: { type: 'string', description: 'The shared copy every network gets unless a variant overrides it.' },
        variants: { type: 'object', description: 'Per-network copy keyed by network id.' },
        linkUrl: { type: 'string', description: 'Destination URL appended to networks with no link field.' },
        mediaUrls: { type: 'array', items: { type: 'string' }, description: 'Public https image URLs the networks fetch themselves.' },
        mediaObjectIds: { type: 'array', items: { type: 'string' }, description: 'Canvas objects whose picture should be attached — an image, mockup, chart or drawing already on this board. Prefer this over mediaUrls for anything the canvas made: the picture is published to a public URL for you, which is what Instagram needs.' },
        networks: { type: 'array', items: { type: 'string' }, description: 'Restrict targets to these networks. Omit to target every ready account.' },
        scheduledAt: { type: 'string', description: 'ISO instant to publish at. Omit to leave it a draft.' },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = socialAccountGate('canvas_create_social_campaign');
      if (gated) return gated;
      const args = raw as {
        name?: string; body?: string; variants?: Record<string, string>; linkUrl?: string;
        mediaUrls?: string[]; mediaObjectIds?: string[]; networks?: string[]; scheduledAt?: string; x?: number; y?: number;
      };
      let accounts: Awaited<ReturnType<typeof socialApi.accounts>>;
      try {
        accounts = await socialApi.accounts();
      } catch (error) {
        return { error: toolErrorMessage(error, 'The connected accounts could not be read.') };
      }
      const wanted = (args.networks ?? []).filter(isSocialNetworkName);
      const targets = accounts.accounts
        .filter((account) => account.ready && (wanted.length === 0 || wanted.includes(account.network)))
        .map((account) => account.id);
      if (targets.length === 0) {
        // ACTIONABLE, AND IT OPENS THE THING IT NAMES. Telling a model in chat to "use
        // the social panel on this canvas" left the user hunting a rail icon for a
        // panel Brain could not reach — so this opens it, and names the tool that
        // would have opened it, rather than describing a destination.
        setDockPanel('social');
        return {
          error: accounts.accounts.length === 0
            ? 'No social account is connected to this workspace yet, so there is nothing to publish to. The social panel is now open on this canvas — connect X, LinkedIn, Facebook, Instagram or TikTok there, or call canvas_connect_social_account to list what each one needs. Say that in one sentence, and author the campaign copy on the board now so it is ready the moment an account is connected.'
            : `Connected accounts exist but none is ready to publish: ${accounts.accounts.map((account) => `${account.networkLabel} · ${account.name} needs ${account.missingFields.map((field) => field.label).join(', ') || 'setup'}`).join('; ')}. The social panel is now open — those fields are filled in on the connection itself. Relay exactly which field is missing on which account; do not describe this as the product being unable to post.`,
          accounts: accounts.accounts.map((account) => ({
            network: account.network, name: account.name, ready: account.ready,
            missing: account.missingFields.map((field) => field.label),
          })),
        };
      }

      // THE PICTURE THE BOARD ALREADY MADE, MADE FETCHABLE.
      //
      // Instagram does not receive media, it FETCHES it — with no session — so a
      // campaign carrying the `data:` URI a generated image lives in was a target
      // silently `skipped` with a blocker nobody could clear from the canvas. Both
      // named objects and hand-passed urls go through the SAME resolver the social
      // panel uses, so a campaign a model drafts and one a person composes attach
      // the identical URL.
      const mediaSources = [
        ...(args.mediaObjectIds ?? []).map((id) => {
          const node = stage.object(id);
          return node ? canvasMediaSource(node.data) : null;
        }),
        ...(Array.isArray(args.mediaUrls) ? args.mediaUrls.map(String) : []),
      ].filter((value): value is string => !!value);
      const missingObjects = (args.mediaObjectIds ?? []).filter((id) => {
        const node = ctx.nodes().find((candidate) => candidate.id === id);
        return !node || !canvasMediaSource(node.data);
      });
      const media = await resolvePublicMediaUrls(mediaSources, { name: String(args.name ?? 'Campaign image') });

      let created: Awaited<ReturnType<typeof socialApi.createCampaign>>;
      try {
        created = await socialApi.createCampaign({
          name: String(args.name ?? '').trim(),
          body: String(args.body ?? '').trim(),
          connectionIds: targets,
          ...(args.variants ? { variants: args.variants as Partial<Record<SocialNetwork, string>> } : {}),
          ...(args.linkUrl ? { linkUrl: args.linkUrl } : {}),
          ...(media.urls.length ? { mediaUrls: media.urls } : {}),
          ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
          // ONLY A SAVED SESSION. `social_campaigns.session_id` is a uuid FK to
          // `creation_sessions`, and an unsaved board's id is the literal string
          // `local-<uuid>` — so sending it unconditionally made every campaign drafted
          // from an unsaved board fail at the database with an error the user reads as
          // "posting is broken". The link is what rolls delivery up into this board's
          // outcome ledger; a board that has no row cannot be in it, and drafting the
          // campaign matters more than the rollup.
          ...(persistence === 'server' && sessionId ? { sessionId } : {}),
        });
      } catch (error) {
        return { error: toolErrorMessage(error, 'That campaign could not be drafted.') };
      }

      const node = stage.createObject('socialCampaign', args);
      node.data = { ...node.data, ...socialCampaignNodeData(created.campaign) };
      node.style = { width: 440, height: 460 };
      stage.addObject(`Add social campaign “${created.campaign.name}”`, node);
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'socialCampaign', title: created.campaign.name },
        campaignId: created.campaign.id,
        targets: created.campaign.targets,
        accounts: created.campaign.posts.map((post) => `${post.network} · ${post.accountName}`),
        blockers: created.campaign.blockers,
        scheduled: created.campaign.scheduledAtISO,
        ...(media.urls.length ? { mediaUrls: media.urls } : {}),
        // Reported rather than thrown: one unusable picture must not lose the
        // campaign, and the model has to be able to say WHICH one and why —
        // "Instagram was skipped" with no reason is the answer this replaces.
        ...(media.problems.length ? { mediaProblems: media.problems.map((problem) => ({ source: problem.source, reason: describePublicMediaProblem(problem) })) } : {}),
        ...(missingObjects.length ? { mediaObjectsWithoutPictures: missingObjects } : {}),
      };
    },
  },   {
    name: 'canvas_publish_social_campaign',
    description: 'PUBLISH a social campaign that is on the canvas to every account it targets. THIS IS PUBLIC AND CANNOT BE UNDONE — confirm with the user before calling it, and never call it to "test" a campaign. Each account is published at most once, so a retry is safe; networks that need media and have none are skipped rather than failed. The tile updates in place with each account\'s outcome and permalink.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { objectId: { type: 'string', description: 'The social campaign object. Omit when the canvas holds exactly one.' } },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const gated = socialAccountGate('canvas_publish_social_campaign');
      if (gated) return gated;
      const objectId = (raw as { objectId?: string }).objectId;
      const campaigns = ctx.nodes().filter((node) => node.data.kind === 'socialCampaign');
      const target = objectId ? campaigns.find((node) => node.id === objectId) : campaigns.length === 1 ? campaigns[0] : undefined;
      if (!target) return { error: campaigns.length ? 'Say which social campaign to publish.' : 'There is no social campaign on this canvas yet.' };
      const campaignId = Number(target.data.campaignId);
      if (!Number.isInteger(campaignId)) return { error: 'That campaign tile is not bound to a saved campaign.' };

      let batch: Awaited<ReturnType<typeof socialApi.publishCampaign>>;
      try {
        batch = await socialApi.publishCampaign(campaignId);
      } catch (error) {
        return { error: toolErrorMessage(error, 'That campaign could not be published.') };
      }
      if (batch.campaign) {
        stage.updateObject(`Publish social campaign ${target.id}`, target.id, socialCampaignNodeData(batch.campaign));
      }
      return {
        ok: true, proposed: true, objectId: target.id,
        published: batch.published, failed: batch.failed, skipped: batch.skipped,
        remaining: batch.remaining, status: batch.status, results: batch.results,
      };
    },
  }];
}
