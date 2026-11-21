/**
 * The ROADMAP ALIGNMENT tool — `roadmap.align_tickets`, spread into `builtinMcpService`'s
 * `CATALOG`.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Asked to validate every open ticket against ROADMAP.md and the spec files, an agent
 * with no tool for it read 106 of 584 roadmap lines by hand and gave up. This answers
 * the whole question in ONE call: it reads the roadmap and the spec files it links from
 * the project's connected repo (or the roadmap from a Brain upload), loads the open
 * tickets in one SQL read, and returns the gap/ticket/spec join from
 * `application/roadmap/alignTicketsToRoadmap.ts`.
 *
 * Not the `roadmap.*` CRUD tools in builtinMcpService — those edit the product-roadmap
 * TABLE; this reads the ROADMAP.md gap register.
 *
 * ── WHICH SPEC FILES ARE READ ────────────────────────────────────────────────────
 * The files the register's gaps link to, plus any `specPaths` given. No tree listing:
 * every output field is about a LINKED file (a dangling anchor, a missing file), so an
 * unlinked spec cannot change the answer, and a recursive tree read of a large monorepo
 * is the most expensive call this tool could make.
 *
 * ── SPEC MODE (`specPath`) ───────────────────────────────────────────────────────
 * "Does every open item of THIS spec have a ticket?" for any markdown spec: the shared
 * `parseSpecOpenItems` + `specTicketCoverage` (`@builderforce/agent-tools`, the pair the
 * Brain's finish gate reads) over the chat's linked tickets (`chatId`) or the project's open
 * ones, shaped by `application/roadmap/specTicketCoverageReport.ts`. Chat #157440 ended with
 * seven spec rows and no ticket for any of them.
 *
 * ── CACHE ────────────────────────────────────────────────────────────────────────
 * The parsed register and spec anchors are cached by the COMMIT sha the ref points at
 * (`resolveRepoCommitSha`): the reader returns no per-file blob sha, and a commit sha is
 * just as content-addressed — an unmoved branch is a hit, any push is a new key. GitHub
 * only (the commit lookup is); other providers and the attachment source read every
 * call. Tickets are never cached: they move turn by turn.
 */
import { TaskRepository } from '../../infrastructure/repositories/TaskRepository';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { isAttachmentKeyOwnedByTenant } from '../assets/tenantAssetStore';
import { integrationCredentialSecret } from '../integrations/integrationCredentialSecret';
import { readRepoFile, resolveRepoCommitSha, type RepoReadContext } from '../repos/readRepoContents';
import { resolveDefaultRepoForProject } from '../repos/resolveDefaultRepo';
import { normalizeRepoPath } from '../repos/repoPath';
import { isResolveError, resolveRepoCredential } from '../repos/resolveRepoCredential';
import { alignTicketsToRoadmap, specAnchorsOf, type AlignTicket } from '../roadmap/alignTicketsToRoadmap';
import { specTicketCoverageReport } from '../roadmap/specTicketCoverageReport';
import { ChatTicketService } from '../brain/ChatTicketService';
import { parseGapRegister, parseSpecOpenItems, type CoverageTicket, type GapEntry, type SpecOpenItem } from '@builderforce/agent-tools';
import type { Env } from '../../env';
import type { BuiltinCtx, BuiltinTool } from './builtinToolContext';
import { maskSecurityTasks } from './builtinTaskVisibility';
import { idArg } from './builtinToolIds';

type Json = Record<string, unknown>;

const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

export const DEFAULT_ROADMAP_PATH = 'ROADMAP.md';
/** The roadmap's read cap. GitHub's contents API serves files up to 1 MB inline; past that the read fails anyway. */
const MAX_ROADMAP_CHARS = 1_000_000;
/** A spec is read for its headings only; 250k covers the largest spec (make.md, ~213k) with room. */
const MAX_SPEC_CHARS = 250_000;
/** Spec files read at once — bounds the memory held in flight and the parallel subrequests. */
const SPEC_READ_CONCURRENCY = 6;
/** Most spec files one call reads (linked + `specPaths`). */
export const MAX_SPEC_FILES = 40;
/** Most open tickets one call joins; `ticketsTruncated` says when a board is bigger. */
export const MAX_ALIGN_TICKETS = 5000;
const CACHE_TTL_SECONDS = 3600;

/** The repo source: a reader plus, when the provider has one, the commit sha to cache by. */
export interface RoadmapRepoSource {
  repoLabel: string;
  read(path: string, maxChars: number): Promise<{ ok: true; content: string; truncated: boolean } | { ok: false; reason: string }>;
  commitSha(): Promise<string | null>;
}

/** A roadmap-relative link as a repo path. */
const repoPathOf = (roadmapPath: string, file: string): string => {
  const dir = roadmapPath.includes('/') ? roadmapPath.slice(0, roadmapPath.lastIndexOf('/')) : '';
  return normalizeRepoPath(dir ? `${dir}/${file}` : file);
};

/** The project's connected (default) repo as a {@link RoadmapRepoSource}, or null when it has none. */
async function projectRepoSource(ctx: BuiltinCtx, projectId: number, ref: string | undefined): Promise<RoadmapRepoSource | { error: string } | null> {
  const repoRef = await resolveDefaultRepoForProject(ctx.db, ctx.tenantId, projectId);
  if (!repoRef) return null;
  if (!ctx.env) return { error: 'repository access is unavailable in this context' };
  const cred = await resolveRepoCredential(ctx.db, integrationCredentialSecret(ctx.env), ctx.tenantId, repoRef.repoId);
  if (isResolveError(cred)) return { error: `cannot read the project's repository: ${cred.error}` };
  const read: RepoReadContext = {
    provider: cred.repo.provider, host: cred.repo.host, owner: cred.repo.owner, repo: cred.repo.repo,
    token: cred.token, ref: (ref ?? cred.repo.defaultBranch ?? 'main').trim(),
  };
  return {
    repoLabel: `${cred.repo.owner}/${cred.repo.repo}@${read.ref}`,
    read: async (path, maxChars) => {
      const r = await readRepoFile({ ...read, maxFileChars: maxChars }, path);
      return r.ok ? { ok: true, content: r.content, truncated: r.truncated } : r;
    },
    commitSha: async () => {
      const r = await resolveRepoCommitSha(read);
      return r.ok ? `${repoRef.repoId}:${r.sha}` : null;
    },
  };
}

interface ParsedSources {
  gaps: GapEntry[];
  specAnchors: Record<string, string[]>;
  /** Files that could not be read (reason), keyed by repo path. */
  unreadable: Record<string, string>;
  /** Files cut at the read cap — their tail was not parsed. */
  truncated: string[];
  /** Linked files (roadmap-relative) that EXIST but could not be read (too large, network,
   *  over the file cap) — listed under unreadableFiles, never as specFilesMissing. */
  unreadableLinked: string[];
}

const isNotFound = (reason: string): boolean => /not found/i.test(reason);

/** Read the roadmap and its linked specs from the repo, and parse them. */
async function parseFromRepo(
  source: RoadmapRepoSource,
  roadmapPath: string,
  roadmapText: string | null,
  specPaths: readonly string[],
): Promise<ParsedSources | { error: string }> {
  const unreadable: Record<string, string> = {};
  const unreadableLinked: string[] = [];
  const truncated: string[] = [];
  let roadmap = roadmapText;
  if (roadmap == null) {
    const r = await source.read(roadmapPath, MAX_ROADMAP_CHARS);
    if (!r.ok) return { error: `cannot read ${roadmapPath} from ${source.repoLabel}: ${r.reason}` };
    if (r.truncated) truncated.push(roadmapPath);
    roadmap = r.content;
  }
  const gaps = parseGapRegister(roadmap);
  // Keyed by the file as the roadmap links it; explicit specPaths are repo paths, keyed
  // back to roadmap-relative only when they sit under the roadmap's directory.
  const wanted = new Map<string, string>();
  for (const g of gaps) for (const l of g.specLinks) wanted.set(l.file, repoPathOf(roadmapPath, l.file));
  for (const p of specPaths) {
    const repoPath = normalizeRepoPath(p);
    const dir = roadmapPath.includes('/') ? `${roadmapPath.slice(0, roadmapPath.lastIndexOf('/'))}/` : '';
    wanted.set(dir && repoPath.startsWith(dir) ? repoPath.slice(dir.length) : repoPath, repoPath);
  }
  const files = [...wanted.entries()].slice(0, MAX_SPEC_FILES);
  const specs: Record<string, string> = {};
  // A small worker pool, not one Promise.all over every file: at most
  // SPEC_READ_CONCURRENCY spec bodies are in flight at once.
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const [file, repoPath] = files[next++]!;
      const r = await source.read(repoPath, MAX_SPEC_CHARS);
      if (!r.ok) {
        unreadable[repoPath] = r.reason;
        if (!isNotFound(r.reason)) unreadableLinked.push(file);
        continue;
      }
      if (r.truncated) truncated.push(repoPath);
      specs[file] = r.content;
    }
  };
  await Promise.all(Array.from({ length: Math.min(SPEC_READ_CONCURRENCY, files.length) }, worker));
  for (const [file, repoPath] of [...wanted.entries()].slice(MAX_SPEC_FILES)) {
    unreadable[repoPath] = `not read: over the ${MAX_SPEC_FILES}-file cap`;
    unreadableLinked.push(file);
  }
  return { gaps, specAnchors: specAnchorsOf(specs), unreadable, truncated, unreadableLinked };
}

/** The open, non-fan-out tickets of the project in ONE SQL read, security-masked. */
async function loadOpenTickets(ctx: BuiltinCtx, projectId: number): Promise<{ tickets: AlignTicket[]; total: number }> {
  const repo = new TaskRepository(ctx.db);
  const { tasks, total } = await repo.findPage(
    ctx.tenantId,
    { scope: 'open', projectId, isFanoutCopy: false },
    { limit: MAX_ALIGN_TICKETS, offset: 0 },
  );
  const rows = await maskSecurityTasks(ctx, tasks.map((t) => t.toPlain() as unknown as Json));
  return {
    total,
    tickets: rows.map((r) => ({
      id: Number(r.id),
      title: String(r.title ?? ''),
      description: typeof r.description === 'string' ? r.description : null,
      status: String(r.status ?? ''),
      parentTaskId: r.parentTaskId != null ? Number(r.parentTaskId) : null,
    })),
  };
}

/** Ticket kinds a spec item is filed as. */
const TASK_TIER_KINDS: ReadonlySet<string> = new Set(['task', 'epic', 'gap']);

/** The chat's linked task-tier tickets (any lane — the coverage join drops cancelled ones), as coverage rows. */
async function loadChatTickets(ctx: BuiltinCtx, chatId: number): Promise<CoverageTicket<number | string>[] | { error: string }> {
  const links = await new ChatTicketService(ctx.db, ctx.env as Env).listTicketsForChat(ctx.tenantId, chatId, ctx.userId ?? null);
  if ('error' in links) return links;
  return links
    .filter((l) => TASK_TIER_KINDS.has(l.kind) && l.label !== '(deleted)')
    .map((l) => ({ id: Number.isFinite(Number(l.ref)) ? Number(l.ref) : l.ref, title: l.label, status: l.status }));
}

/** The spec's open items, read from the repo (cached by commit sha) or from the attachment. */
async function specItemsFrom(
  ctx: BuiltinCtx,
  specPath: string,
  source: RoadmapRepoSource | null,
  attachmentText: string | null,
): Promise<{ items: SpecOpenItem[]; truncated: boolean; cachedBy: 'commit-sha' | null } | { error: string }> {
  if (attachmentText != null) return { items: parseSpecOpenItems(attachmentText), truncated: false, cachedBy: null };
  if (!source) return { error: 'no source to read the spec from' };
  const load = async (): Promise<{ items: SpecOpenItem[]; truncated: boolean } | { error: string }> => {
    const r = await source.read(specPath, MAX_ROADMAP_CHARS);
    if (!r.ok) return { error: `cannot read ${specPath} from ${source.repoLabel}: ${r.reason}` };
    return { items: parseSpecOpenItems(r.content), truncated: r.truncated };
  };
  const sha = await source.commitSha();
  if (!sha) {
    const r = await load();
    return 'error' in r ? r : { ...r, cachedBy: null };
  }
  const r = await getOrSetCached(
    ctx.env,
    `roadmap-align:spec:v1:${ctx.tenantId}:${sha}:${specPath}`,
    async () => {
      const loaded = await load();
      // An unreadable spec must not be pinned for the TTL.
      if ('error' in loaded) throw new Error(loaded.error);
      return loaded;
    },
    { kvTtlSeconds: CACHE_TTL_SECONDS },
  ).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
  return 'error' in r ? r : { ...r, cachedBy: 'commit-sha' };
}

const strArg = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const ROADMAP_ALIGNMENT_TOOLS: BuiltinTool[] = [
  {
    tool: 'roadmap.align_tickets',
    mutates: false,
    description:
      'THE one call for "are the open tickets aligned with the roadmap / the specs?" — never read ROADMAP.md or page tasks.list by hand for this. '
      + 'Parses the ROADMAP.md Consolidated Gap Register (every gap: stage, group, tags, summary, spec links), joins it with the project\'s open tickets '
      + '(fan-out copies excluded; a child of a matched ticket counts under its parent) and checks every gap\'s spec link against the spec file\'s real headings. '
      + 'A ticket matches a gap when its title/description contains the gap id or the gap\'s exact spec link, or its title is the same work as the gap summary. '
      + 'Returns { gaps, tickets, gapsByStage, matched, and the three gap lists: gapsWithoutTicket (roadmap work no ticket covers), ticketsWithoutGap (tickets no gap backs), '
      + 'danglingSpecLinks (gap links to a spec heading that does not exist), plus specFilesMissing }; each list is { items, total, truncated }. '
      + 'Reads from the project\'s connected repo (roadmapPath default "ROADMAP.md", optional ref, optional extra specPaths); or pass roadmapAttachmentKey to use an uploaded roadmap '
      + '(the key after /uploads/ in the attachment URL). '
      + 'SPEC MODE — pass specPath (any markdown spec or PRD) to ask "does every open item of this spec have a ticket?": it parses the spec\'s status-table rows '
      + '(ID + Status columns: Incomplete/Complete/Blocked/…), checklist items and gap-register bullets, and joins the incomplete and blocked ones with the chat\'s linked tickets '
      + '(chatId) or else the project\'s open tickets. A ticket covers an item when it names the item id (P25-09, OUT-02, §6.6) or its title is the same work; an auto-captured '
      + '"Code change (N files)" ticket never covers one. Returns { items, openItems, itemsByStatus, tickets, covered, missing } (missing rows carry id, title, status, section, line, blocker); '
      + 'roadmapAttachmentKey then holds the spec instead of the repo file.',
    parameters: obj({
      projectId: N,
      roadmapPath: { ...S, description: 'Repo path of the roadmap (default "ROADMAP.md"). Spec links resolve relative to its directory.' },
      specPaths: { type: 'array', items: S, description: 'Extra spec files (repo paths) to read besides the ones the gaps link to.' },
      ref: { ...S, description: 'Branch or ref to read (default: the repo\'s default branch).' },
      roadmapAttachmentKey: { ...S, description: 'A Brain upload holding the roadmap (or, with specPath, the spec), instead of the repo file.' },
      specPath: { ...S, description: 'Spec mode: repo path of a markdown spec whose open items must each have a ticket.' },
      chatId: { ...N, description: 'Spec mode: join with the tickets linked to this Brain chat instead of the project\'s open tickets.' },
    }, ['projectId']),
    run: async (ctx: BuiltinCtx, a: Json) => {
      const projectId = idArg(a.projectId, 'projectId');
      const roadmapPath = normalizeRepoPath(strArg(a.roadmapPath) ?? DEFAULT_ROADMAP_PATH);
      const ref = strArg(a.ref);
      const attachmentKey = strArg(a.roadmapAttachmentKey);
      const specPaths = Array.isArray(a.specPaths) ? a.specPaths.filter((p): p is string => typeof p === 'string' && p.trim() !== '') : [];
      const specPathArg = strArg(a.specPath);
      const specPath = specPathArg ? normalizeRepoPath(specPathArg) : null;
      const chatId = a.chatId != null ? idArg(a.chatId, 'chatId') : null;

      let attachmentText: string | null = null;
      if (attachmentKey) {
        const uploads = ctx.env?.UPLOADS;
        if (!uploads) return { error: 'file storage is unavailable in this context' };
        if (!isAttachmentKeyOwnedByTenant(attachmentKey, ctx.tenantId)) return { error: 'attachment not found' };
        const object = await uploads.get(attachmentKey);
        if (!object) return { error: 'attachment not found' };
        attachmentText = await object.text();
      }

      const resolved = await projectRepoSource(ctx, projectId, ref);
      // A repo that cannot be read is fatal only when it is the sole source: with an
      // attachment, fall back to the attachment-only path and say why specs were skipped.
      if (resolved && 'error' in resolved && attachmentText == null) return resolved;
      const repoError = resolved && 'error' in resolved ? resolved.error : null;
      const source = resolved && !('error' in resolved) ? resolved : null;
      if (!source && attachmentText == null) {
        return {
          error: `Project ${projectId} has no connected repository and no roadmapAttachmentKey was given. `
            + 'Connect the project\'s GitHub repo (the roadmap is read from its ROADMAP.md), or attach the roadmap file in chat and pass its key as roadmapAttachmentKey.',
        };
      }

      if (specPath) {
        const spec = await specItemsFrom(ctx, specPath, source, attachmentText);
        if ('error' in spec) return spec;
        let tickets: CoverageTicket<number | string>[];
        let ticketTotal: number;
        if (chatId != null) {
          const chat = await loadChatTickets(ctx, chatId);
          if ('error' in chat) return chat;
          tickets = chat;
          ticketTotal = chat.length;
        } else {
          const open = await loadOpenTickets(ctx, projectId);
          tickets = open.tickets;
          ticketTotal = open.total;
        }
        return {
          ...specTicketCoverageReport({ projectId, specPath, items: spec.items, tickets }),
          source: {
            ...(source ? { repo: source.repoLabel } : {}),
            spec: attachmentText != null ? `attachment:${attachmentKey}` : specPath,
            tickets: chatId != null ? `chat:${chatId}` : `project:${projectId}:open`,
          },
          ...(ticketTotal > tickets.length ? { ticketsTruncated: { loaded: tickets.length, total: ticketTotal } } : {}),
          ...(spec.truncated ? { truncatedFiles: [specPath] } : {}),
          cachedBy: spec.cachedBy,
        };
      }

      let parsed: ParsedSources;
      let cachedBy: 'commit-sha' | null = null;
      if (source) {
        // The repo read is content-addressed by commit; an attachment can be overwritten in place (attachments.write).
        const sha = attachmentText == null ? await source.commitSha() : null;
        const load = () => parseFromRepo(source, roadmapPath, attachmentText, specPaths);
        const result = sha
          ? await getOrSetCached(
            ctx.env,
            `roadmap-align:v2:${ctx.tenantId}:${sha}:${roadmapPath}:${[...specPaths].sort().join(',')}`,
            async () => {
              const r = await load();
              // An unreadable roadmap must not be pinned for the TTL.
              if ('error' in r) throw new Error(r.error);
              return r;
            },
            { kvTtlSeconds: CACHE_TTL_SECONDS },
          ).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
          : await load();
        if ('error' in result) return result;
        parsed = result;
        if (sha) cachedBy = 'commit-sha';
      } else {
        parsed = { gaps: parseGapRegister(attachmentText!), specAnchors: {}, unreadable: {}, truncated: [], unreadableLinked: [] };
      }

      const { tickets, total } = await loadOpenTickets(ctx, projectId);
      const result = alignTicketsToRoadmap({
        tenantId: ctx.tenantId,
        projectId,
        roadmapMarkdown: '',
        specs: {},
        gaps: parsed.gaps,
        specAnchors: parsed.specAnchors,
        unreadableSpecFiles: parsed.unreadableLinked,
        openTickets: tickets,
      });
      return {
        ...result,
        source: source ? { repo: source.repoLabel, roadmap: attachmentKey ? `attachment:${attachmentKey}` : roadmapPath } : { roadmap: `attachment:${attachmentKey}` },
        ...(source ? {} : {
          // No repo: the specs cannot be read, so "missing" would be noise.
          danglingSpecLinks: { items: [], total: 0, truncated: false },
          specFilesMissing: { items: [], total: 0, truncated: false },
          specCheck: repoError
            ? `skipped — the project's repository could not be read (${repoError}); the roadmap came from the attachment`
            : 'skipped — the project has no connected repository to read the spec files from',
        }),
        ...(total > tickets.length ? { ticketsTruncated: { loaded: tickets.length, total } } : {}),
        ...(Object.keys(parsed.unreadable).length ? { unreadableFiles: parsed.unreadable } : {}),
        ...(parsed.truncated.length ? { truncatedFiles: parsed.truncated } : {}),
        cachedBy,
      };
    },
  },
];
