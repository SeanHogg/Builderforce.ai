/**
 * THE CREATION LIBRARY — one list, because there is only one kind of thing in it.
 *
 * ── WHAT THIS FIXES ──────────────────────────────────────────────────────────────
 * The Create destination used to draw two lists. The first was creation sessions,
 * rendered as canvas tiles. The second was "resources" — builds, workflows, chats,
 * projects and agents — rendered underneath as a completely different row shape, as
 * though they were a lesser class of object you could browse but not work in.
 *
 * They were never a second class. Every one of those rows opens by calling
 * `creationSessionsApi.openResource` / `openProject` / `openIdeProject`, which
 * MATERIALISES a creation session and navigates to `/create/<id>`. A workflow row and
 * a canvas tile were two drawings of the same destination — the only real difference
 * being whether the session row had been created yet.
 *
 * So the kind of a thing is a FACET of one library, exactly as the object kind is a
 * facet of one board (`lib/specObjects.ts`) and the surface is a facet of one canvas
 * (`lib/canvasSurfaces.ts`). Adding a source is an entry below plus a describer;
 * nothing downstream branches on which source an item came from.
 *
 * ── WHY THE MAPPING IS PURE ──────────────────────────────────────────────────────
 * The dedupe rule (a session that already holds a card FOR a record suppresses that
 * record's own row) decides what a person sees, and it was previously a `Set`
 * assembled inline in a 300-line component where nothing could test it. It lives here
 * with the shape it protects, and i18n stays out: the caller passes already-translated
 * secondary lines through {@link CreationLibraryDescribers}, a narrow function record
 * rather than a translator this module would have to know the namespace of.
 */

import type { BrainChat, CreationSessionSummary, WorkflowDefinitionSummary } from '@/lib/builderforceApi';
import type { IdeProject, Project, PublishedAgent } from '@/lib/types';
import {
  formatResourceRef,
  representedResourceRefs,
  sortCreationLibrary,
  type CreationLibraryEntry,
  type CreationLibraryFacet,
} from '@builderforce/creation-canvas-contract';

export { CREATION_LIBRARY_FACETS, creationLibraryFacetCounts, type CreationLibraryFacet } from '@builderforce/creation-canvas-contract';

/** A card on the board behind an item, as the tile's preview draws it. */
export interface CreationLibraryPreviewObject {
  id: string;
  kind: string;
  x: number;
  y: number;
  title: string;
  status?: string;
}

/**
 * The records the library can open. A closed union rather than a string, so the one
 * place that turns a record into a session (each type has its own `…/open` endpoint)
 * is exhaustive by the compiler instead of by a default branch nobody revisits.
 */
export type CreationLibraryResourceType = 'ideProject' | 'workflow' | 'chat' | 'project' | 'agent';

/** How an item that has no session yet is opened. */
export interface CreationLibraryResource {
  type: CreationLibraryResourceType;
  id: string | number;
}

/**
 * The web library's row: the shared entry plus everything a TILE needs that a VS Code
 * tree row does not (a board preview, a localized secondary line, linked projects).
 * The ordering, the facet vocabulary and the dedupe rule come from the shared core —
 * see `@builderforce/creation-canvas-contract`'s `creationLibrary`.
 */
export interface CreationLibraryItem extends CreationLibraryEntry {
  /** The session this item IS. Null means opening it materialises one. */
  sessionId: string | null;
  /** What to open when there is no session yet. Null exactly when `sessionId` is set. */
  resource: CreationLibraryResource | null;
  /** Object kinds on the board, shown as badges. */
  kinds: readonly string[];
  objects: readonly CreationLibraryPreviewObject[];
  objectCount: number;
  collaboratorCount: number;
  unread: boolean;
  folderId: string | null;
  folderName: string | null;
  projectIds: readonly number[];
  /**
   * A glyph to draw INSTEAD of the object preview. Set only when there is nothing to
   * preview — a record whose session does not exist yet has no cards to scatter, and
   * an empty rectangle says less about it than its own mark does.
   */
  icon: string | null;
  /** Already-localized secondary line for records; empty for sessions, whose meta line
   *  the tile assembles from counts it formats itself. */
  subtitle: string;
  /**
   * Whether the session-scoped actions apply — rename, move, merge, pin, archive,
   * delete, bulk-select. They need a session row, so a record that has never been
   * opened has none. Consumers ask this rather than `sessionId != null`, which would
   * read as an implementation detail at the call site.
   */
  managed: boolean;
  /** Object to focus when opened from a search hit. */
  focusObjectId: string | null;
}

/**
 * The secondary line for each record source, already translated.
 *
 * A record's own vocabulary ("Website · active · BuilderForce.AI", "3 runs") is the
 * caller's to phrase, because only the caller has the catalogs. Keeping it a function
 * per source — rather than a pre-built string per row — is what lets this module own
 * the dedupe and the ordering.
 */
export interface CreationLibraryDescribers {
  build: (build: IdeProject) => string;
  workflow: (workflow: WorkflowDefinitionSummary) => string;
  chat: (chat: BrainChat) => string;
  project: (project: Project) => string;
  agent: (agent: PublishedAgent) => string;
}

/** The glyph each record source draws when it has no board to preview. */
export interface CreationLibraryIcons {
  build: (build: IdeProject) => string;
  workflow: string;
  chat: string;
  project: string;
  agent: string;
}

export interface CreationLibraryInput {
  /** Sessions as the server returned them — already searched and status-filtered. */
  sessions: readonly (CreationSessionSummary & { matchingObjectId?: string | null })[];
  builds: readonly IdeProject[];
  workflows: readonly WorkflowDefinitionSummary[];
  chats: readonly BrainChat[];
  projects: readonly Project[];
  agents: readonly PublishedAgent[];
  describe: CreationLibraryDescribers;
  icons: CreationLibraryIcons;
  /**
   * The library's search box. Sessions arrive already matched by the SERVER (which
   * searches object content, not just titles), so the query is applied here only to
   * records — filtering the sessions again would narrow a richer result with a
   * poorer rule.
   */
  query?: string;
  /**
   * Whether records belong in this reading at all. They have no archived state and no
   * folder, so an archived view or a folder filter would otherwise show rows the
   * filter does not describe.
   */
  includeRecords: boolean;
}

/** Case-insensitive contains — the library's one client-side match rule. */
function matches(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || haystack.toLowerCase().includes(needle);
}

function sessionItem(session: CreationSessionSummary & { matchingObjectId?: string | null }): CreationLibraryItem {
  return {
    key: `session-${session.id}`,
    facet: 'canvas',
    sessionId: session.id,
    resource: null,
    title: session.title,
    kinds: session.preview?.kinds ?? [],
    objects: session.preview?.objects ?? [],
    objectCount: session.preview?.objectCount ?? 0,
    collaboratorCount: session.collaboratorCount ?? 1,
    lastActivityAt: session.lastActivityAt,
    pinned: !!session.pinned,
    unread: !!session.unread,
    folderId: session.folderId ?? null,
    folderName: session.folderName ?? null,
    projectIds: session.projectIds ?? [],
    icon: null,
    subtitle: '',
    managed: true,
    focusObjectId: session.matchingObjectId ?? null,
  };
}

/** Shared shape for every record: no session, no folder, nothing to manage yet. */
function recordItem(
  facet: CreationLibraryFacet,
  resource: CreationLibraryResource,
  fields: { title: string; subtitle: string; icon: string; lastActivityAt?: string | null; projectIds?: readonly number[] },
): CreationLibraryItem {
  return {
    key: `${facet}-${resource.id}`,
    facet,
    sessionId: null,
    resource,
    title: fields.title,
    kinds: [],
    objects: [],
    objectCount: 0,
    collaboratorCount: 1,
    lastActivityAt: fields.lastActivityAt ?? null,
    pinned: false,
    unread: false,
    folderId: null,
    folderName: null,
    projectIds: fields.projectIds ?? [],
    icon: fields.icon,
    subtitle: fields.subtitle,
    managed: false,
    focusObjectId: null,
  };
}

/**
 * The library, in display order: pinned first, then everything else by recency, with
 * records a session already represents left out.
 *
 * Recency is what makes ONE list legible where two lists were not — a build touched
 * this morning belongs above a canvas last opened in March, and the old layout could
 * never say so, because the builds were in a different section entirely.
 */
export function creationLibraryItems(input: CreationLibraryInput): CreationLibraryItem[] {
  const sessions = input.sessions.map(sessionItem);

  /** Records a session already holds a card for — those open THAT session, so a
   *  second row for the same record would be two doors into one room. */
  const represented = representedResourceRefs(input.sessions);

  const query = input.query ?? '';
  const records = !input.includeRecords ? [] : [
    ...input.builds
      .filter((build) => !represented.has(formatResourceRef('ideProject', build.id)!))
      .map((build) => recordItem('build', { type: 'ideProject', id: build.id }, {
        title: build.name,
        subtitle: input.describe.build(build),
        icon: input.icons.build(build),
        lastActivityAt: build.updatedAt ?? null,
        projectIds: build.containerProjectId ? [build.containerProjectId] : [],
      })),
    ...input.workflows
      .filter((workflow) => !represented.has(formatResourceRef('workflow', workflow.id)!))
      .map((workflow) => recordItem('workflow', { type: 'workflow', id: workflow.id }, {
        title: workflow.name,
        subtitle: input.describe.workflow(workflow),
        icon: input.icons.workflow,
        projectIds: workflow.projectId ? [workflow.projectId] : [],
      })),
    ...input.chats
      .filter((chat) => !represented.has(formatResourceRef('chat', chat.id)!))
      .map((chat) => recordItem('chat', { type: 'chat', id: chat.id }, {
        title: chat.title,
        subtitle: input.describe.chat(chat),
        icon: input.icons.chat,
        lastActivityAt: chat.updatedAt ?? null,
        projectIds: chat.projectId ? [chat.projectId] : [],
      })),
    ...input.projects
      .filter((project) => !represented.has(formatResourceRef('project', project.id)!))
      .map((project) => recordItem('project', { type: 'project', id: project.id }, {
        title: project.name,
        subtitle: input.describe.project(project),
        icon: input.icons.project,
        lastActivityAt: project.updatedAt ?? project.updated_at ?? null,
      })),
    ...input.agents
      .filter((agent) => !represented.has(formatResourceRef('agent', agent.id)!))
      .map((agent) => recordItem('agent', { type: 'agent', id: agent.id }, {
        title: agent.name,
        subtitle: input.describe.agent(agent),
        icon: input.icons.agent,
      })),
  ].filter((item) => matches(`${item.title} ${item.subtitle}`, query));

  return sortCreationLibrary([...sessions, ...records]);
}
