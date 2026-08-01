# PRD 17 — Creation Sessions and the Infinite Canvas

**Status:** P0/P1 implementation candidate complete (2026-08-01); production rollout gates remain · **Owner:** Product + Platform · **Migrations:** `0388_creation_sessions.sql`, `0389_creation_session_collaboration.sql`, `0390_creation_session_commands.sql`

## 1. Executive summary

Builderforce.ai currently divides creation across Brain Storm, Workflows, and the IDE/Builder. Each surface has its own entry point and mental model even though users experience them as one continuous act: ask, explore, make, evaluate, refine, and deliver.

This PRD replaces those competing creation entry points with **Creation Sessions**: durable, tenant-owned, multiplayer canvases at `/create/:sessionId`. A session is the evolution of chat. It preserves the familiar bottom prompt composer and conversation history while allowing every Builderforce resource—workflows, websites, projects, tasks, agents, datasets, charts, reports, documents, voice, code, and generated artifacts—to appear as a live, draggable object on one infinite canvas.

Users do not need a Project to begin. Teams may add one or more Project objects when they need delivery context, portfolio comparisons, maturity measures, task assignment, governance, or a destination for generated work. A generated roadmap or mockup can become a project artifact and task, be assigned to an AI agent, and stream delivery status back into the originating session.

The product flow becomes:

```text
Homepage prompt
  → anonymous local-first Creation Session (no project or assigned resource required)
  → optional sign in / create account when the user wants sync, collaboration, or delivery
  → tenant is selected or created automatically
  → complete local graph is claimed into a server session
  → optional starter project is provisioned
  → guided Creation Session
  → return to Dashboard → Create session cards
```

### Implementation note

The initial vertical slice now includes anonymous prompt-to-canvas routing, legacy
`/brainstorm?prompt=` bridging, intent-aware object seeding, local-to-server graph
claiming, durable tenant-scoped session APIs, atomic revisioned graph saves, visual
Dashboard session cards, project-to-canvas opening, role-based invitations, the consolidated
Create navigation, and a native VSIX Creation Session editor. The canvas composer
now uses the production Brain stream and tenant MCP registry, with an explicit
change-set review boundary for mutating canvas tools. Active-member presence, live
cursors/selections, personal viewport persistence, conflict reconciliation, comments,
mentions, activity, durable commands, idempotency, and named revision checkpoints
provide the shared collaboration loop.

The object registry now also includes live website editing, CSV/TSV datasets and
generated charts, canonical project expansion, task/agent delivery, and Evermind.
An Evermind object can expand its dataset → tokenizer → tuning → evaluation →
telemetry pipeline directly on the canvas. Anonymous users can design that pipeline
locally; a server session can attach it to a canonical Project and reuse the existing
production Evermind console for seeding, teaching, training/flush, validation,
inference settings, maintenance, and version telemetry.

The implemented collaboration and migration layer includes durable object comments,
mentions metadata, resolvable threads, merged activity reads, role-aware canvas
editing/running, evidence-backed multi-Project comparisons, canonical impromptu
stand-ups, canonical Agent settings, streamed artifact delivery, and wrapper-session
adapters for Brain chats, Workflow definitions, and Projects. Legacy adapters are on
by default and retain visible fallbacks. Canvas defaults, palette entries, icons, and
AI tool enums originate in one tested creation-object registry rather than separate catalogs.

Migration `0389_creation_session_collaboration.sql` is the forward-only production
upgrade for presence and comments. It intentionally repeats `IF NOT EXISTS` guards
from the evolving `0388` definition because deployed environments may already have
recorded `0388` before those collaboration fields were added.

Migration `0390_creation_session_commands.sql` adds durable snapshots, named
checkpoints, per-member cursors/selections/viewports, pinned sessions, and the
revisioned command path. It must be applied before deploying clients that call
`/commands`, `/history`, `/checkpoints`, or session pinning.

`/dashboard` remains the default landing page. Its first and default tab becomes **Create**, showing visual session cards and a prompt that creates a new session immediately.

## 2. Problem

### User problem

- Users think in goals and conversations, not product modules or project schemas.
- Brainstorming, workflow design, website creation, data visualization, voice, and agent configuration require route changes and context switching.
- Chat outputs are transient. Copy/download exists, but outputs do not naturally remain connected to the inputs, decisions, people, and execution that created them.
- A Project is often required too early. Individual creators may not care about projects until they want to organize or deliver the result.
- Teams need projects for metrics and governance, but cannot visually compare projects or ask questions across project resources in one place.
- Existing navigation exposes duplicate or overlapping creation concepts: Brain Storm, Workflows, IDE/Builder, and creation-capability tiles.

### Business problem

- Multiple creation surfaces fragment activation and make onboarding harder to explain.
- Context is lost between ideation and execution, reducing successful agent delegation.
- Collaboration happens around pages rather than around a durable body of work.
- The application already contains valuable reports, dashboards, workflows, workforce, and delivery primitives, but users cannot compose them into a situational workspace.

## 3. Vision and product principles

**Vision:** Builderforce.ai is one intelligent creation canvas where people and agents think, make, evaluate, and deliver together.

Principles:

1. **Session first.** The durable unit users return to is a session, not a prompt, tool, or required project.
2. **Canvas primary, chat familiar.** The canvas owns the page; chat and the bottom composer remain familiar controls and can also exist as canvas objects.
3. **Projects are optional context.** They organize and measure work without gating creation.
4. **Live objects, not screenshots.** A dropped Workflow, Project, Website, Dashboard, or Agent remains the canonical resource and can be acted on in place.
5. **Explicit relationships.** Spatial proximity is visual only. Typed connections define data flow, execution, reference, ownership, or presentation.
6. **AI sees structure.** Brain reasons over selected objects and their authoritative data, not only the pixels on the canvas.
7. **Creation closes the delivery loop.** Generated work can become project artifacts, tasks, and agent assignments without leaving the session.
8. **Multiplayer by default.** Presence, comments, prompts, approvals, and agent output are shared session events.
9. **One product registry.** Anything in Builderforce.ai can declare how it appears and behaves on the canvas; the canvas does not maintain a duplicate catalog.
10. **Safe mutations.** Multi-resource AI changes are previewed, permission-checked, approval-gated, versioned, and auditable.

## 4. Goals and non-goals

### Goals

- Unify Brain Storm, workflow authoring, website/prototype creation, LLM creation, voice, and data visualization in one surface.
- Make `/create/:sessionId` the canonical creation route.
- Preserve familiar prompting, response actions, downloads, and conversation continuity.
- Allow zero, one, or multiple Project objects in a session.
- Support cross-object questions and evaluations with linked evidence.
- Provide visual session discovery on the Dashboard.
- Simplify first-run onboarding to a guided canvas session.
- Make sessions available in the VS Code extension through a native shared webview implementation.
- Migrate existing chats, workflows, and IDE/project entry points without data loss or broken deep links.

### Non-goals for initial release

- Replacing authoritative Project, Task, Workflow, Agent, or Dashboard APIs with a new canvas-only database.
- Treating every object touching another as an executable connection.
- Full offline multiuser editing.
- Arbitrary unreviewed AI writes across several resources.
- Removing Projects, Insights, Workforce, Knowledge, or administrative surfaces that serve reporting/governance needs.
- Achieving feature parity for every application resource in phase one; the object registry enables incremental adoption.

## 5. Users and jobs to be done

### Individual creator

- “Let me start with an idea without configuring a project.”
- “Let me return to the conversation and everything it produced.”
- “Create a workflow, page, model, voice experience, or visualization in the same session.”

### Product and delivery team

- “Bring in a project and show all related work visually.”
- “Turn approved mockups into tasks and assign an agent to build them.”
- “Summarize requested features, generate concepts, and deliver them into the roadmap.”

### Leader or portfolio owner

- “Compare two projects’ features, maturity, rating, performance, and productivity.”
- “Create an executive or sales roadmap from the project context on this canvas.”
- “Use current reports and dashboards as evidence for a decision.”

### Cross-functional team

- “Invite teammates into a working session.”
- “Pull staff and agents into an impromptu stand-up.”
- “Ask Brain to identify gaps and capture follow-up work while everyone is present.”

## 6. Information architecture and routes

### Canonical routes

```text
/dashboard                              Default signed-in landing page
/dashboard?tab=create                   Default dashboard tab
/create                                 Session library; may redirect to dashboard Create tab
/create/new                             Creates session, then replaces URL
/create/:sessionId                      Canonical canvas session
/create/:sessionId?focus=:objectId      Open with object selected
/create/:sessionId?present=1            Presentation/follow mode
```

### Legacy compatibility routes

| Existing route | Transitional behavior | Final behavior |
| --- | --- | --- |
| `/brainstorm` | Open/create a session with Chat selected | Redirect to session; remove primary menu item |
| `/workflows` | Show sessions filtered to Workflow objects or legacy list | Redirect/filter within Create |
| `/workflows/builder?id=:id` | Open owning session with Workflow selected; create wrapper session if needed | Redirect to canonical session focus URL |
| `/ide/dashboard` | Show project/build sessions during migration | Redirect/filter within Create |
| `/ide/:id` | Open owning session with Code/Browser object selected | Redirect to canonical session focus URL |
| `/projects/:id` | Open or create the user’s most recent session containing that Project object | Canonical session URL; Project selected |

No legacy route hard-redirects until the related resource has an owning/wrapper session and telemetry confirms deep-link reliability.

## 7. Menu redesign

### Primary navigation after consolidation

1. Dashboard
2. Create
3. Projects
4. Workforce
5. Insights
6. Knowledge
7. Marketplace
8. Settings / administration as permission permits

Remove **Brain Storm**, **Workflows**, and **IDE/Builder** as separate primary destinations. They remain capabilities and canvas-object filters, not destinations.

### Create navigation behavior

When expanded, Create shows:

- `+ New session`
- Search sessions
- Recent/pinned session list
- Optional filters: All, Mine, Shared, Project-backed, Workflow, Website, Data, LLM, Voice
- A session row opens `/create/:sessionId` and restores viewport, selections, and unread activity.

When collapsed, Create is one icon with a badge for unread session activity. The current session title appears in the canvas header, not as a new global navigation level.

### Project navigation behavior

Projects remain a primary destination for portfolio management, structured metrics, maturity, ownership, budgeting, and bulk administration. Opening a specific Project from a card/table uses a session-aware action:

- If the user has a recent session containing the Project, open it.
- Otherwise create a session titled from the Project and add the Project object.
- An explicit **Open project details** action remains for administrative fields that are not appropriate on the canvas.

## 8. Dashboard redesign

`/dashboard` remains the signed-in default. The first and default tab changes from Projects to **Create**.

### Create tab

- A prominent bottom-style prompt or dashboard prompt: **“What would you like to create?”**
- Submitting creates a session, saves the initial prompt, navigates to `/create/:sessionId`, and begins streaming Brain output.
- Visual session cards show a server-generated or cached miniature rendering of the canvas—not generic list rows.
- Each card shows title, preview, collaborators, object-type chips, associated projects, last activity, running agents, and unread activity.
- Card actions: Open, Pin, Rename, Duplicate, Share, Archive.
- Sections: Continue creating, Shared with me, Templates, Recently completed.
- Empty state starts the guided first session rather than explaining product modules.

### Other dashboard tabs

- Projects remains for portfolio/project cards.
- Workforce remains for people and agents.
- Insights/Quality/Knowledge may remain as appropriate, but Ideas and IDE tabs are removed or folded into Create filters.
- The global dashboard prompt always creates a Creation Session; it does not create a Project first.

### Session preview generation

- Store a lightweight preview descriptor on save: viewport crop, object bounding boxes, colors/icons, and safe text snippets.
- Generate the card thumbnail asynchronously; do not rasterize the full canvas on every keystroke.
- Sensitive objects may opt out and render as redacted placeholders.

## 9. Simplified onboarding

### Target flow

1. User signs in or creates an account.
2. User supplies a name; company is optional.
3. Accept current terms and choose account mode only when required by policy.
4. If the user has no tenant, create one automatically:
   - company name when supplied;
   - otherwise display name;
   - otherwise username/email prefix;
   - fallback `My workspace`, never the implementation-facing name `Default` in UI.
5. Best-effort create a starter Project named `My first project`. Failure must not block creation.
6. Create a first session titled `My first creation` and navigate to its canvas.
7. Run an interactive walkthrough.

Users can rename the tenant and starter Project later. Invited users join the inviter’s tenant and skip tenant/project provisioning.

### Canvas walkthrough

The walkthrough is stateful, dismissible, replayable, and no more than six steps:

1. Ask Brain from the bottom composer.
2. Drag an object from Add.
3. Select an object to target Brain and open its inspector.
4. Connect two objects and ask a cross-object question.
5. Invite a collaborator.
6. Optionally add the starter Project and deliver an artifact.

The tutorial uses real session objects and leaves a useful result behind. Completion is recorded per user, not per tenant.

## 10. Session model and lifecycle

### Definition

A Creation Session is a tenant-owned collaborative workspace containing:

- title and optional description;
- canvas graph and viewport;
- conversation timeline;
- live resource references;
- canvas-native artifacts;
- AI actions and proposals;
- collaborators and permissions;
- comments and mentions;
- version history and activity;
- zero or more Project associations.

### Lifecycle

`active → archived → restored` with optional soft deletion. Sessions autosave and never require a manual Save for canvas state. Resource mutations retain their resource-specific Save/Run/Publish behavior.

### Ownership

- Tenant owns the session.
- Creator is initial owner.
- Multiple Projects may be referenced but do not own the session.
- A session can be personal within the tenant until shared.
- Archiving a Project does not delete a session; its object becomes read-only with an archived state.

## 11. Canvas interaction model

### Spatial behavior

- Infinite pan/zoom canvas with dotted background.
- Drag/drop and click-to-add from a searchable object palette.
- Move, resize, group/frame, align, duplicate, lock, hide, and delete canvas placements.
- Marquee selection, keyboard navigation, copy/paste, undo/redo, minimap, zoom-to-selection.
- Freehand drawing, arrows, sticky notes, comments, and presentation frames.
- Object levels: compact card, expanded interactive object, and focus mode.

### Composer and scope

The familiar composer remains fixed at bottom center. Its explicit scope chip is one of:

- Entire canvas
- Selected object
- N selected objects
- Connected objects
- Current frame

The prompt may include attachments, voice, model/persona choice, and an optional project delivery target. Pressing Enter sends; Shift+Enter creates a line break. The request and response are always recorded in the session timeline even when no Chat object is visible.

### Connections

```ts
type ConnectionKind =
  | 'data'          // dataset → chart → prototype
  | 'control'       // workflow execution order
  | 'reference'     // evaluation cites project/report
  | 'presentation'  // chart appears in page/deck
  | 'delivery'      // artifact → task/project
  | 'membership';   // project → related task/workflow/agent
```

Edges have labels, direction where relevant, validation, and accessible text alternatives. Only explicit edges affect execution or AI relationship semantics.

## 12. Canvas object registry

Every application resource type registers:

```ts
interface CanvasObjectDefinition {
  kind: string;
  label: string;
  capability?: string;
  compactRenderer: React.ComponentType;
  expandedRenderer: React.ComponentType;
  inspector?: React.ComponentType;
  contextAdapter(ref): Promise<AgentReadableContext>;
  actions(ref): CanvasAction[];
  allowedConnections: ConnectionRule[];
  previewAdapter(ref): SessionPreviewItem;
}
```

### Required object types

| Category | Objects | Representative live actions |
| --- | --- | --- |
| Conversation | Chat, AI answer, evaluation | Prompt, branch, cite, apply recommendations |
| Build | Workflow, Website, WYSIWYG Prototype, Code, Browser Preview, LLM, Voice | Edit, run, preview, publish, train, evaluate |
| Work | Project, Task, Roadmap, PRD, Release, Feature, Mockup | Expand, compare, assign, approve, deliver |
| Data | Dataset, Table, Spreadsheet, Chart, Report, Dashboard, KPI | Import, profile, filter, visualize, refresh, drill |
| Knowledge | Document, Slide deck, Knowledge item, File, URL | Edit, summarize, export, use as context |
| Workforce | Agent, Staff Member, Team, Role | Inspect, configure, assign, invite, mention |
| Collaboration | Stand-up frame, Comment, Sticky note, Drawing, Timer | Facilitate, summarize, capture actions |
| Integrations | MCP tool, connected application resource | Authenticate, choose operation, execute with approval |

The Add palette is generated from this registry and the user’s capabilities. It must not become a manually duplicated inventory.

## 13. Projects as live canvas context

### Add and open

- Drag a Project from the palette/search results.
- Open a Project route and have Builderforce open/create a session containing that Project object.
- Ask Brain to add a named Project.

### Project card

Compact view includes health, maturity, rating, velocity/productivity, owner, recent activity, open risk, and running agent count. Expanded view provides tabs for Overview, Delivery, Features, Metrics, People, and Relationships. The right inspector exposes administrative fields permitted for the user.

### Expand project

**Add all related items** queries the project graph and adds a grouped visual subgraph. Lens choices:

- Everything
- Features and customer requests
- Roadmap and delivery
- Tasks and dependencies
- Workflows and agents
- Documents and code
- Metrics and dashboards
- Risks, quality, and governance

Expansion is idempotent: an existing object is focused/reused, not duplicated. The session stores placement references, not copies of project records.

### Compare projects

Selecting two or more Project objects enables **Compare**. Brain returns a comparison object covering requested dimensions such as:

- feature inventory and gaps;
- maturity/rating;
- delivery velocity and predictability;
- performance/productivity;
- cost and AI utilization;
- quality, incidents, risk, and compliance;
- staffing and agent allocation.

Every comparison statement cites a source object or metric and its freshness.

## 14. AI behavior and cross-object reasoning

### Context assembly

Brain receives:

- session goal and recent conversation;
- selected object schemas and canonical resource data;
- typed connections and current frame;
- relevant comments and decisions;
- project and tenant policy/capability boundaries;
- MCP results requested for the action;
- token-budgeted summaries for unselected canvas regions.

Canvas pixels are never the only source of truth. Visual screenshots may supplement structured context for WYSIWYG evaluation.

### Example: campaign effectiveness

Workflow + Website + forecast Dashboard → user asks whether the campaign will be effective → Brain produces a persistent Evaluation object with verdict, evidence, gaps, confidence, and proposed changes. **Apply recommendations** opens a multi-resource diff and allows individual acceptance.

### Example: executive or sales roadmap

Project selected → user requests a roadmap → Brain creates a Roadmap object tailored to `sales`, `executive`, `product`, or `delivery` audience. Claims cite the Project’s current features, metrics, dependencies, and delivery state. The roadmap can become slides or be attached to the Project.

### Example: top requested features

User asks for a visual summary of the top ten requested features and mockups for all:

1. Brain collects tenant feedback, ideas, support signals, surveys, and linked MCP sources.
2. It normalizes/deduplicates requests and records source counts and freshness.
3. It adds a ranked Feature Summary object with evidence.
4. It generates ten linked Mockup objects or one expandable Mockup Set containing ten screens.
5. The user reviews/edits concepts.
6. **Deliver to project** creates/links features and tasks, attaches approved mockups, selects agents, and starts approval-gated execution.

### AI command contract

AI mutates the session through typed commands, not arbitrary client code:

```ts
type CanvasCommand =
  | { type:'object.add'; object: CanvasObjectInput }
  | { type:'object.update'; id:string; patch: unknown }
  | { type:'connection.add'; connection: ConnectionInput }
  | { type:'project.expand'; projectId:number; lens:string }
  | { type:'artifact.deliver'; artifactId:string; projectId:number; agentRef?:string }
  | { type:'resource.changeSet.propose'; changes: ResourceChange[] };
```

Commands are schema-validated, authorized, idempotent, logged, and broadcast to collaborators.

## 15. Creation-to-delivery workflow

1. User or Brain creates an artifact (mockup, roadmap, document, workflow, website, model).
2. Artifact is reviewed and versioned in the session.
3. User selects **Deliver** and chooses Project, task behavior, assignee, due date, and approval policy.
4. API creates or links the canonical artifact and Task.
5. Agent assignment uses the existing runtime and governance policies.
6. Task/run status streams into the canvas object.
7. Produced files, preview, tests, and approvals attach to both the Task and session.
8. Brain summarizes completion in the session timeline.

The delivery transaction must be idempotent. Repeating Deliver focuses the existing Task unless the user explicitly chooses Duplicate.

## 16. Multiplayer collaboration

- Invite roles: Viewer, Commenter, Editor, Runner, Owner.
- Underlying resource permissions remain authoritative; session Editor does not automatically gain Project admin rights.
- Live presence, cursors, selections, viewport, object editing, comments, mentions, and typing indicators.
- Personal viewport by default; optional Follow/Present mode.
- Soft object locks for complex editors with visible owner and timeout.
- Shared prompts identify requester; streamed AI output is visible to all collaborators.
- Activity feed records joins, prompts, commands, runs, approvals, deliveries, settings changes, and version restores.
- Comments can target session, frame, object, connection, or a sub-element exposed by the object renderer.

### Impromptu stand-up

A Stand-up frame accepts Staff Member and Agent objects. Cards show current work, blockers, availability, recent activity, and relevant task status. Brain can facilitate in sequence, summarize, find cross-person dependencies, and create follow-up tasks or workflow changes.

## 17. Agent management on canvas

Agent objects display identity, current status, model, runtime, active task, tools, autonomy, cost/usage, and recent quality. Selecting an Agent opens the contextual right panel:

- name/persona and instructions;
- model/provider;
- skills and MCP tools;
- memory/knowledge bindings;
- autonomy and approval ceiling;
- execution target/host;
- cost and usage limits;
- pause/resume and current activity.

Saving calls the canonical Agent API. Updates appear everywhere and require normal permissions/approvals. The canvas never stores a divergent agent configuration.

## 18. Data model — `0388_creation_sessions.sql`

All tables are tenant-scoped, segment-aware where applicable, additive, and created idempotently.

### `creation_sessions`

```text
id UUID PK
tenant_id INT FK tenants ON DELETE CASCADE
segment_id UUID NULL
title VARCHAR(255)
description TEXT NULL
status VARCHAR(16) DEFAULT 'active'       -- active | archived
created_by VARCHAR(36) FK users
updated_by VARCHAR(36) FK users
canvas_revision BIGINT DEFAULT 0
preview JSONB NULL                        -- safe lightweight card descriptor
last_activity_at TIMESTAMPTZ
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
archived_at TIMESTAMPTZ NULL
```

Indexes: `(tenant_id,status,last_activity_at DESC)`, `(created_by,last_activity_at DESC)`, segment index.

### `creation_session_objects`

```text
id UUID PK
session_id UUID FK creation_sessions ON DELETE CASCADE
kind VARCHAR(48)
resource_type VARCHAR(64) NULL
resource_id VARCHAR(128) NULL
resource_revision VARCHAR(128) NULL
canvas_data JSONB                         -- x,y,w,h,z,collapsed,frameId,style
content JSONB NULL                        -- canvas-native only; never large blobs
created_by VARCHAR(36)
updated_by VARCHAR(36)
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
UNIQUE(session_id,resource_type,resource_id) WHERE resource_id IS NOT NULL
```

### `creation_session_connections`

```text
id UUID PK
session_id UUID FK creation_sessions ON DELETE CASCADE
source_object_id UUID FK creation_session_objects ON DELETE CASCADE
target_object_id UUID FK creation_session_objects ON DELETE CASCADE
kind VARCHAR(24)
label VARCHAR(255) NULL
metadata JSONB NULL
created_by VARCHAR(36)
created_at TIMESTAMPTZ
```

### `creation_session_members`

```text
session_id UUID FK creation_sessions ON DELETE CASCADE
user_id VARCHAR(36) FK users ON DELETE CASCADE
role VARCHAR(16)                    -- viewer | commenter | editor | runner | owner
invited_by VARCHAR(36)
last_seen_revision BIGINT DEFAULT 0
joined_at TIMESTAMPTZ
PRIMARY KEY(session_id,user_id)
```

### `creation_session_events`

Append-only durable activity/command log:

```text
id UUID PK
session_id UUID FK creation_sessions ON DELETE CASCADE
revision BIGINT
actor_type VARCHAR(16)              -- user | agent | system
actor_ref VARCHAR(128)
event_type VARCHAR(64)
object_id UUID NULL
payload JSONB
idempotency_key VARCHAR(128) NULL
created_at TIMESTAMPTZ
UNIQUE(session_id,revision)
UNIQUE(session_id,idempotency_key) WHERE idempotency_key IS NOT NULL
```

### `creation_session_project_links`

```text
session_id UUID FK creation_sessions ON DELETE CASCADE
project_id INT FK projects ON DELETE CASCADE
added_by VARCHAR(36)
created_at TIMESTAMPTZ
PRIMARY KEY(session_id,project_id)
```

Large files, audio, datasets, code trees, generated sites, and mockup bundles use the existing artifact/storage systems and are referenced by ID.

## 19. API surface

Base: `/api/creation-sessions`

| Method | Path | Minimum role | Purpose |
| --- | --- | --- | --- |
| GET | `/` | member | List/search/filter sessions and dashboard previews |
| POST | `/` | member | Create session; accepts initial prompt/template/project refs |
| GET | `/:id` | session viewer | Load snapshot, objects, connections, membership |
| PATCH | `/:id` | editor | Rename/archive/update metadata |
| DELETE | `/:id` | owner | Soft-delete session |
| POST | `/:id/commands` | editor | Apply typed idempotent canvas commands |
| GET | `/:id/events?after=` | viewer | Catch up after revision |
| POST | `/:id/invite` | owner/editor policy | Invite collaborator |
| PATCH | `/:id/members/:userId` | owner | Change role/remove member |
| POST | `/:id/ai` | editor | Stream scoped Brain request and canvas commands |
| POST | `/:id/projects/:projectId/expand` | viewer | Return related object graph for a lens |
| POST | `/:id/artifacts/:objectId/deliver` | runner | Attach/create task and assign execution |
| GET | `/:id/preview` | viewer | Lightweight visual card descriptor/image |

All reads/writes enforce tenant, segment, session membership, underlying resource capability, and role. Resource adapters batch reads to prevent an expanded Project from creating N+1 API traffic.

## 20. Realtime, persistence, and versioning

- Durable database snapshot + append-only revision events.
- Realtime transport broadcasts presence and accepted events; reconnect uses `after=lastRevision` catch-up.
- Canvas geometry may use Yjs/CRDT for concurrent spatial edits; canonical resource mutations remain API transactions.
- Debounced autosave for geometry with optimistic UI and conflict reconciliation.
- AI commands and delivery operations use idempotency keys.
- Session history supports named checkpoints and restore-as-new-revision; it never rewrites audit history.
- Viewport is personal by default and stored per user/session; shared presentation viewport is ephemeral.

## 21. Permissions, security, and governance

- Tenant isolation on every session row, object ref, query, event, and broadcast channel.
- Session membership cannot grant access to an underlying Project/Agent/Dataset the user cannot read. Render a permission placeholder instead.
- Sensitive object definitions control preview redaction and AI-context inclusion.
- AI context adapters return least-privilege structured data and source citations.
- Runs, publishing, external messages, agent autonomy changes, and multi-resource writes honor existing approval gates.
- Invites expire and are auditable.
- Export excludes inaccessible/redacted objects.
- MCP credentials remain server-side and are never serialized into canvas state or events.

## 22. VS Code extension

Creation Sessions must be available in the VSIX as the same tenant sessions.

### User experience

- Add **BuilderForce: Open Creation Session…** command.
- Add Sessions tree: Recent, Pinned, Shared, Running.
- Open canvas in a full editor tab, not the narrow activity sidebar.
- Support New Session without a workspace folder or Project.
- Add VS Code-native objects: current file, selection, diagnostics, repository, terminal output, local service, browser preview.
- Double-click Code/File/Task objects to open the corresponding editor or existing native panel.
- Share presence and comments with web collaborators; show a VS Code presence indicator.

### Architecture

Do not iframe `/create`. The existing extension documents that iframe `/embed/*` pages were unreliable in VS Code webviews. Extract the spatial engine, object registry contracts, canvas command types, and portable renderers into a shared package consumed by:

- `frontend/src/components/creation-canvas`
- `clients/vscode/webview`

The VSIX host supplies authentication, CSP-safe assets, theme tokens, editor bridges, and deep-link actions through the existing webview message protocol.

## 23. Existing component reuse map

| Need | Existing primitive | Direction |
| --- | --- | --- |
| Spatial graph | `@xyflow/react` in `WorkflowBuilder.tsx` | Extract single canvas shell, controls, edges, DnD |
| Workflow nodes | `BuilderNode`, `nodeKinds`, integrations | Register as Workflow object and nested nodes |
| Chat | `BrainPanel`, `ChatInput`, message/actions | Render Chat object and global scoped composer |
| Freeform blocks | `CanvasBoard`, `canvasModel` | Port resize/content behavior into XYFlow object types |
| Context inspector | `NodeConfigPanel` | Generalize by registry object definition |
| LLM build | `EvermindBuildPanel` | LLM object inspector/focus view |
| Widget catalog | app widget registry and `WidgetCard` | Canvas Report/Dashboard/Chart objects |
| Project relations | project/PMO/inspection APIs | Project context adapter and expand lenses |
| Workforce | Workforce agents/members views | Agent and Staff object adapters |
| Realtime/editor sync | existing collaboration/Yjs dependencies | Session geometry and presence |
| Embedded client protocol | VSIX webview shared protocol | Add session commands/events, no iframe |

Use XYFlow as the one spatial engine. Do not nest `CanvasBoard` or a second ReactFlow instance inside the main viewport except an isolated Workflow focus editor, because competing pan, zoom, selection, and keyboard models are inaccessible and error-prone.

## 24. Legacy content migration

### Brain chats

- Backfill one session per eligible chat or lazily create on first open.
- Add a Chat object and preserve messages, project references, generated artifacts, timestamps, and participants.
- Multiple related chats may later be merged explicitly; do not silently merge during migration.

### Workflows

- Preserve canonical Workflow rows.
- Create a wrapper session when opened if no session references the Workflow.
- Existing workflow IDs and run history remain unchanged.

### IDE projects/builds

- Preserve Project, code, preview, model, voice, and build entities.
- Opening an existing specific project creates/opens a session containing a Project object plus the relevant Code/Browser/LLM/Voice object.

### Navigation and bookmarks

- Maintain route adapters for at least two releases.
- Record legacy-route usage, redirect success, and session-creation failures.
- Never strand a resource because wrapper-session creation failed; fall back to the legacy surface with a visible recovery message.

## 25. Rollout plan

### Phase 0 — Vertical slice (in progress)

- `/create` and `/create/:sessionId` shell.
- XYFlow canvas, palette, live-style objects, inspector, scoped composer.
- Local persistence prototype, seeded campaign session, AI evaluation demo.
- Project expansion, roadmap/feature/mockup demonstrations.

### Phase 1 — Durable sessions

- Migration and Session CRUD/event APIs.
- Tenant-scoped session library and Dashboard Create tab.
- Chat, Workflow, Project, Note, Website/Browser objects.
- Autosave, preview descriptors, basic sharing and presence.
- Guided onboarding session.

### Phase 2 — Resource registry and data/prototype loop

- Application-wide object registry.
- Dataset import, charts, reports, dashboards.
- WYSIWYG interactive prototype and breakpoint preview.
- Project expansion lenses and multi-project comparison.
- Cross-object evaluation with citations and change previews.

### Phase 3 — Delivery and workforce

- Artifact → Project/Task → Agent delivery transaction.
- Agent and Staff objects, agent configuration inspector.
- Stand-up frames, comments, mentions, activity feed, approvals.
- Feature-request synthesis and mockup-set generation.

### Phase 4 — Navigation and VSIX consolidation

- Dashboard Create default tab.
- Remove Brain Storm, Workflows, and IDE/Builder primary menu entries.
- Activate legacy redirects after telemetry thresholds.
- Shared canvas package and native VSIX editor-tab surface.

### Phase 5 — Advanced collaboration and templates

- Presentation/follow mode, named checkpoints, richer drawings.
- Session templates: Campaign, Product discovery, Data story, Stand-up, Model build, Executive review.
- Marketplace-distributed object packs/templates within capability controls.

## 26. Success metrics

### Activation

- Time from account creation to first session prompt.
- Percentage of new users completing first useful canvas action within ten minutes.
- Tutorial completion/dismissal and replay rates.

### Creation

- Weekly active creators and sessions.
- Sessions containing two or more object kinds.
- Prompt-to-persistent-artifact conversion.
- Return rate to an existing session vs starting a new chat.

### Delivery

- Artifacts delivered to Projects/Tasks.
- Agent assignments initiated from sessions.
- Delivery completion/approval rate and time.

### Collaboration

- Shared sessions, invited collaborators, concurrent editors.
- Comments/mentions resolved and stand-up actions created.

### Consolidation

- Reduction in navigation among Brainstorm/Workflow/IDE routes for one outcome.
- Legacy route usage and redirect error rate.
- Session wrapper creation success ≥ 99.9% before hard redirects.

### Guardrails

- Unauthorized object/context access: zero.
- Duplicate delivery operations under retry: zero.
- P95 session load under 2.5 seconds for 100 visible objects.
- P95 accepted canvas command broadcast under 300 ms in-region.

## 27. Accessibility, responsive behavior, and performance

- Full keyboard object navigation, selection, movement, connection creation, and inspector access.
- Every visual graph provides a structured list/text alternative.
- WCAG 2.2 AA contrast, focus, motion, and target-size requirements.
- Reduced-motion support for cursors, edges, and streaming states.
- Mobile supports view/comment/prompt and focused object editing; complex spatial authoring is tablet/desktop first.
- Virtualize or hide off-screen heavy renderers; compact objects outside the viewport.
- Lazy-load code editor, WYSIWYG, charts, audio, and workflow focus bundles.
- Batch project expansions and object context reads.
- Enforce initial targets: 100 visible / 1,000 referenced objects per session; warn and suggest frames/sub-sessions above target.

## 28. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Canvas becomes an unstructured junk drawer | Frames, templates, search, object filters, Brain organization commands |
| Live object and source resource drift | Store references; canonical APIs remain authoritative |
| AI context becomes too large | Selection scope, structured adapters, summaries, freshness, explicit expansion |
| Accidental cross-resource changes | Change-set preview, per-change acceptance, approvals, idempotency |
| Navigation migration confuses existing users | Compatibility routes, in-product messaging, telemetry-gated redirects |
| Session/project mental models blur | Session = creative context; Project = optional measured delivery context; reinforce in copy |
| Large sessions perform poorly | Viewport virtualization, compact modes, batching, preview descriptors, soft limits |
| Concurrent edits conflict | CRDT for geometry/comments; locks/transactions for complex canonical editors |
| VSIX diverges from web | Shared package/contracts and conformance tests; platform adapters only |
| Session thumbnails expose data | Safe preview adapter per object, redaction, tenant-authenticated delivery |

## 29. Acceptance criteria

### Session and dashboard

- `/dashboard` defaults to a Create tab with visual session cards.
- Submitting the Dashboard prompt creates a tenant-owned session, navigates to it, and preserves the initial prompt.
- A user can create and revisit a session without creating or selecting a Project.
- Session cards show current preview, collaborators, projects, activity, and running state.

### Canvas

- Users can add, drag, resize, connect, group, select, delete, and restore supported objects.
- Composer scope visibly reflects canvas, selection, connected objects, or frame.
- Chat is addable/removable and the conversation remains in session history regardless.
- Workflow, Website, Dashboard, Agent, Staff, and Project objects expose meaningful in-place actions.

### Projects and delivery

- Opening an existing Project opens/creates a session with that Project object selected.
- One session supports multiple Projects and evidence-backed comparison.
- Add all related items produces an idempotent project subgraph using a chosen lens.
- Brain creates sales/executive roadmaps grounded in selected Project data.
- Brain can synthesize the top ten requested features and generate linked visual mockups.
- An approved Mockup can be attached to a Project, turned into a Task, assigned to an Agent, and tracked without leaving the session.

### Collaboration and governance

- Invited users concurrently see accepted canvas events, prompts, and AI output.
- Session roles and underlying resource permissions are both enforced.
- AI multi-resource mutations require a reviewable change set and existing approval policy.
- Agent settings changed in the canvas are reflected across Builderforce.ai.

### Onboarding and navigation

- A new standalone user receives an automatically named tenant, best-effort starter Project, first session, and replayable walkthrough.
- Invited users do not receive a redundant tenant.
- Brain Storm, Workflow, and IDE creation entry points are removed from primary navigation only after compatibility telemetry passes.
- Old bookmarks open the correct session/object without data loss.

### VSIX

- Users can create/open the same tenant sessions from a native full editor tab.
- Web and VSIX clients pass shared command, persistence, permission, and rendering conformance tests.
- VSIX sessions work without a local workspace folder or Project.

## 30. Decisions and open questions

### Recommended decisions

- Use **Create** as the product/navigation label and **Session** as the durable item label.
- Keep `/dashboard` as landing and make Create its default tab.
- Keep Projects as an organizational/reporting destination.
- Use server-stored sessions from phase one; local-only sessions are prototype behavior, not product architecture.
- Use a native VSIX webview backed by a shared package, not iframe embedding.
- Represent ten feature mockups as an expandable Mockup Set by default to avoid canvas overload; users can expand all.

### Phase 1 decisions (resolved)

- Personal Sessions default to creator-private; tenant visibility requires an explicit invitation/share action.
- Automatic workspace naming uses company/organization name when supplied, then a sanitized display name, then the email local part. Invited users always join the inviter’s workspace and never trigger a second workspace.
- Starter Project creation is lazy and best-effort at the tutorial’s delivery step. A failed Project provision never blocks a usable Session.
- Session/artifact/history retention and storage use the plan quota service; the UI warns before the API rejects a quota-consuming action.
- Archived Sessions are excluded from global search by default and included through an explicit status filter.
- Opening a Project prefers the user’s most-recent accessible Session containing that Project; otherwise it creates or opens the shared canonical wrapper Session.
- Geometry, cursors, selection, comments, drawings, notes, and frame layout use optimistic collaborative commands. Canonical resource content uses the authoritative API and its lock/version/approval behavior; destructive multi-resource changes require preview and review.

## 31. Design references

- [Creation Canvas design proposal](../../docs/design/creation-canvas/README.md)
- [Unified canvas overview](../../docs/design/creation-canvas/creation-canvas-overview.png)
- [Data visualization and WYSIWYG prototype](../../docs/design/creation-canvas/creation-canvas-data-prototype.png)
- [Collaborative campaign evaluation](../../docs/design/creation-canvas/creation-canvas-collaboration.png)

## 32. Prioritized functional requirements

Priority meanings: **P0** is required before the new navigation becomes default; **P1** is required for general availability; **P2** may follow GA without changing the core model.

| ID | Priority | Requirement |
| --- | --- | --- |
| CS-001 | P0 | Create a tenant-scoped session without requiring a Project. |
| CS-002 | P0 | Persist title, objects, geometry, connections, conversation, revision, and personal viewport. |
| CS-003 | P0 | Restore a session from `/create/:sessionId` with tenant and membership authorization. |
| CS-004 | P0 | Add/move/resize/select/delete/restore objects and create typed connections. |
| CS-005 | P0 | Provide a bottom composer with explicit canvas/selection/frame scope. |
| CS-006 | P0 | Render Chat, Workflow, Project, Website/Browser, Note, and Agent objects through registry definitions. |
| CS-007 | P0 | Open a contextual inspector for the selected object and call its canonical API. |
| CS-008 | P0 | Autosave accepted canvas commands with idempotency and revision ordering. |
| CS-009 | P0 | Create a new session from the Dashboard prompt and preserve the submitted prompt. |
| CS-010 | P0 | Show visual session cards as the first/default Dashboard tab. |
| CS-011 | P0 | Provide wrapper-session creation for existing chats, workflows, and projects. |
| CS-012 | P0 | Preserve legacy deep links until wrapper creation and telemetry gates pass. |
| CS-013 | P0 | Enforce both session membership and underlying resource permissions. |
| CS-014 | P0 | Provide onboarding that results in a usable first session even if starter-Project provisioning fails. |
| CS-015 | P1 | Share a session and support live presence, cursors, comments, and activity. |
| CS-016 | P1 | Add Dataset, Chart, Report, Dashboard, WYSIWYG, LLM, Voice, Staff, Task, Roadmap, and Mockup objects. |
| CS-017 | P1 | Expand a Project into an idempotent related-resource graph by lens. |
| CS-018 | P1 | Compare two or more Projects using cited, fresh metrics and features. |
| CS-019 | P1 | Evaluate connected objects and produce persistent evidence-backed Evaluation objects. |
| CS-020 | P1 | Preview and selectively apply AI-proposed multi-resource change sets. |
| CS-021 | P1 | Deliver an artifact to a Project/Task, assign an Agent, and stream execution back into the session. |
| CS-022 | P1 | Synthesize requested features with citations and generate an expandable Mockup Set. |
| CS-023 | P1 | Generate audience-specific Roadmap and Slide objects from Project context. |
| CS-024 | P1 | Support session invitations with Viewer, Commenter, Editor, Runner, and Owner roles. |
| CS-025 | P1 | Remove redundant primary menu entries after migration gates pass. |
| CS-026 | P1 | Supply a native VSIX Creation Session surface backed by the same APIs and command contracts. |
| CS-027 | P2 | Provide presentation/follow mode and named session checkpoints. |
| CS-028 | P2 | Distribute session templates and object packs through Marketplace. |
| CS-029 | P2 | Support advanced freehand drawing, spatial facilitation, and reusable custom frames. |
| CS-030 | P2 | Offer session branching/merging with an explicit conflict-resolution experience. |

## 33. User stories

### Starting and returning

- As a new user, I can type what I want to create immediately after onboarding without understanding Projects.
- As a returning user, I can recognize a prior session from its visual card and continue where I stopped.
- As a user, I can search sessions by title, object content, collaborator, Project, or artifact.
- As a user, I can pin, rename, duplicate, archive, restore, or share a session.

### Building

- As a creator, I can drag a Workflow into my session and run or edit it in place.
- As a creator, I can drag in a Website and use a high-fidelity WYSIWYG experience without changing routes.
- As an analyst, I can import data, visualize it, and bind the visualization into a prototype.
- As a model builder, I can configure, train, compare, and package an LLM from objects in the same session.
- As a voice creator, I can record, transcribe, synthesize, and connect voice interactions to another object.

### Project context and delivery

- As an individual, I can ignore Projects until I am ready to organize or deliver work.
- As a product manager, I can add a Project and expand its features, tasks, roadmap, metrics, agents, and files.
- As a portfolio owner, I can compare two Projects and see source-backed differences.
- As a leader, I can generate a sales or executive roadmap grounded in a Project’s actual state.
- As a product team, I can summarize the ten most-requested features, create visual mockups, and deliver approved concepts into a Project.
- As a delivery lead, I can create a Task from a mockup, assign an AI Agent, approve execution, and see results in the session.

### Collaboration

- As a session owner, I can invite a colleague with an appropriate role.
- As a collaborator, I can see who is present, where they are working, and what changed.
- As a manager, I can arrange Staff and Agent objects into an impromptu stand-up and ask Brain to facilitate and capture actions.
- As a reviewer, I can comment on a specific object or proposed change without gaining edit/run permission.

## 34. Navigation migration matrix

| Current navigation item/tab | Action | Replacement |
| --- | --- | --- |
| Dashboard | Keep | Default landing; Create becomes first/default tab |
| Brain Storm | Remove from primary nav | Create session with Chat object/filter |
| Workflows | Remove from primary nav | Workflow object filter in Create; Workflow library accessible from Add/search |
| IDE | Remove from primary nav | Code/Browser/Website/LLM/Voice objects and project/build session filter |
| Dashboard → Projects tab | Keep, move after Create | Portfolio/project cards and structured administration |
| Dashboard → Ideas tab | Remove | Create sessions filtered to Chat/Discovery |
| Dashboard → IDE tab | Remove | Create sessions filtered to Code/Website/Model/Voice |
| Projects | Keep | Portfolio metrics, maturity, rating, governance, administration |
| Workforce | Keep | Organization-wide people/agents; both are also canvas objects |
| Insights | Keep | Organization-wide measurement; reports/widgets also appear on canvas |
| Knowledge | Keep | Knowledge administration; documents are canvas objects |
| Marketplace | Keep | Tools/templates/object packs available from Add |

Menu removal is controlled by `creation_sessions_nav` feature flag. When disabled, existing navigation remains unchanged. When enabled for a tenant, legacy destinations remain reachable by URL but are no longer primary items.

## 35. State machines

### Session

```text
creating → active ↔ archived → deleted (soft) → purged
              │
              ├─ degraded-readonly (resource/API/realtime incident)
              └─ migrating (legacy wrapper/backfill only)
```

- `creating` is transactional and must resolve to `active` or roll back.
- `degraded-readonly` is derived operational state, not persisted lifecycle status.
- Delete enters retention before permanent purge according to plan/policy.

### AI request

```text
queued → assembling_context → running → proposing_changes → awaiting_approval
   └──────────────→ failed          └──────────────→ complete
                                         └─────────→ rejected
```

The session timeline exposes each transition. Cancel is allowed before a change is committed. A retry reuses the request idempotency key unless the user chooses “Try a different approach.”

### Artifact delivery

```text
draft → reviewed → delivery_proposed → approved → task_created → assigned
  → running → awaiting_review → delivered
                    └→ changes_requested → running
```

## 36. API contracts

### Create session

```http
POST /api/creation-sessions
Idempotency-Key: <uuid>
```

```json
{
  "title": "Fall campaign launch",
  "initialPrompt": "Create a campaign for our fall collection",
  "templateId": "campaign",
  "projectIds": []
}
```

```json
{
  "session": { "id": "uuid", "title": "Fall campaign launch", "revision": 1 },
  "initialRequestId": "uuid"
}
```

### Apply canvas commands

```http
POST /api/creation-sessions/:id/commands
If-Match: <canvasRevision>
Idempotency-Key: <uuid>
```

```json
{
  "commands": [
    { "type": "object.add", "clientId": "temp-1", "kind": "project", "resourceRef": { "type": "project", "id": "42" }, "geometry": { "x": 120, "y": 80, "w": 320, "h": 220 } },
    { "type": "connection.add", "sourceId": "temp-1", "targetId": "object-2", "kind": "reference" }
  ]
}
```

Response contains accepted commands, server IDs, resulting revision, and rejected-command errors. Atomicity defaults to the command batch; callers may set `atomic:false` only for safe geometry-only batches.

### Ask Brain

```http
POST /api/creation-sessions/:id/ai
Accept: text/event-stream
```

```json
{
  "prompt": "Compare these projects and create an executive roadmap",
  "scope": { "type": "selection", "objectIds": ["object-a", "object-b"] },
  "attachments": [],
  "mode": "propose"
}
```

SSE event types: `request.accepted`, `context.progress`, `message.delta`, `command.proposed`, `approval.required`, `command.applied`, `artifact.ready`, `request.complete`, `request.error`.

### Expand project

```json
POST /api/creation-sessions/:id/projects/42/expand
{ "lens": "features-and-feedback", "depth": 2, "reuseExisting": true }
```

The response is a proposed object/connection command batch so the client can preview a large expansion before applying it.

### Deliver artifact

```json
POST /api/creation-sessions/:id/artifacts/:objectId/deliver
{
  "projectId": 42,
  "task": { "mode": "create", "title": "Build approved onboarding mockup", "priority": "high" },
  "agentRef": "agent:campaign-strategist",
  "approvalPolicy": "project-default"
}
```

Returns canonical artifact/task refs, assignment/run state, and the canvas command batch linking them.

## 37. Search and discovery

Global search and the Create library index:

- session title/description;
- safe text extracted by each object’s search adapter;
- Project names and feature/task identifiers;
- collaborators and creator;
- object kinds and statuses;
- generated artifact titles;
- timestamps and pinned/archived/shared state.

Search never indexes secrets, private dataset rows, raw credentials, or redacted object content. Results enforce current permissions at query time. Opening a result focuses the matching object and briefly highlights it.

## 38. Notifications and attention

Events eligible for in-app/email/connected-channel notification:

- session invitation or role change;
- mention/comment/reply;
- approval requested or resolved;
- agent delivery completed/failed/blocked;
- collaborator requests access to a referenced resource;
- AI proposal waiting for review;
- session archived or restored.

Routine geometry changes, cursor movement, autosaves, and prompt token deltas never create notifications. Users configure session-level watch state: All activity, Mentions and assignments, or Muted.

## 39. Plans, quotas, and billing

Quotas are enforced at APIs and communicated before an action begins:

- active/archived session count;
- collaborators per session;
- stored artifact bytes;
- retained revision/event history;
- concurrent AI/agent runs;
- dataset size and row-processing limits;
- realtime concurrent editors;
- session templates/private object packs by plan.

Canvas geometry, navigation, comments, and viewing do not consume model tokens. AI context assembly, generation, evaluation, and agent execution use the existing usage ledger and show estimated/actual cost where available. BYO-provider credentials keep existing billing semantics.

## 40. Empty, loading, and failure states

| Condition | Required behavior |
| --- | --- |
| New blank session | Centered starter suggestions plus composer; palette remains available |
| Session load | Skeleton object bounds and canvas controls; no layout jump after hydration |
| Object resource deleted | Tombstone with who/when and remove/replace actions |
| Object permission missing | Redacted placeholder and request-access action |
| Resource API unavailable | Last-known summary, freshness warning, retry; edit disabled |
| Realtime disconnected | Visible offline/reconnecting state; queue geometry edits locally |
| Revision conflict | Merge geometry when safe; show conflict UI for canonical content |
| AI request failure | Preserve prompt/context, explain failure, retry/change-model controls |
| Partial project expansion | Add successful objects, show exact failures, safe retry without duplicates |
| Delivery transaction failure | Roll back uncommitted links; show canonical task/artifact if partially committed |
| Session exceeds performance target | Suggest frames, collapse heavy objects, or split into linked session |

## 41. Analytics and observability events

Product events:

```text
creation_session_created
creation_session_opened
creation_session_archived
creation_session_shared
creation_prompt_submitted
creation_object_added
creation_object_focused
creation_connection_added
creation_project_expanded
creation_projects_compared
creation_ai_evaluation_completed
creation_change_set_applied
creation_artifact_delivered
creation_agent_assigned
creation_tutorial_step_completed
creation_legacy_route_adapted
```

Every event includes tenant, session, user/actor, client surface (`web|vscode`), object kinds—not sensitive object content—and correlation/request IDs. Operational telemetry includes command latency, snapshot size, event lag, realtime reconnects, context-adapter latency, AI first-token time, rejected commands, permission denials, wrapper-session failures, and preview-generation failures.

Dashboards and alerts:

- session API error and P95/P99 latency;
- command conflict/rejection rate;
- realtime connection health and broadcast lag;
- AI request completion/cancel/error by model/provider;
- delivery transaction failure/duplicate-prevention counts;
- legacy route wrapper and redirect success;
- session preview queue age;
- object renderer crash counts by kind/client.

## 42. Localization and content standards

- All web and VSIX user-facing strings use the existing five catalogs: English, Chinese, Spanish, French, and German.
- Object registry labels, connection kinds, tutorial copy, permission errors, activity events, and generated system messages require localized templates.
- User-authored and AI-authored content is not automatically translated unless requested.
- Dates, numbers, currencies, durations, and relative activity use locale formatters.
- Product terminology is fixed: **Create** (destination/action), **Creation Session** on first explanation, **Session** thereafter, **Canvas**, **Object**, **Project**, **Brain**, and **Deliver**.
- Do not expose internal words such as node, DAG, MCP, tenant, resource adapter, or revision in novice-facing onboarding copy unless context requires them.

## 43. Test strategy

### Unit

- object registry uniqueness/capability gating;
- command schemas and idempotency;
- connection validation;
- context token budgeting and redaction;
- project graph normalization/deduplication;
- session-card preview sanitization;
- tenant-name derivation and invited-user bypass;
- legacy URL → canonical session/focus mapping.

### Integration

- Session CRUD, membership, event revisioning, archive/restore.
- Underlying resource permission intersection.
- Project expansion batching and reuse.
- AI SSE request → proposal → approval → applied command.
- Artifact delivery transaction across artifact/task/assignment/event APIs.
- Realtime reconnect and event catch-up.
- Dashboard prompt → session → initial request.

### End-to-end

1. New user → auto tenant → tutorial session → first object.
2. Existing user → Dashboard session card → restored viewport/conversation.
3. Blank session → Workflow + Website → evaluation → apply one recommendation.
4. Add Project → expand all related items → compare with second Project.
5. Feedback sources → top ten features → Mockup Set → deliver one → Agent completes Task.
6. Invite collaborator → simultaneous changes/comments → reconnect → consistent revision.
7. Legacy Workflow/Brain/IDE/Project URL → correct wrapper session and focused object.
8. Same session opened in web and VSIX → shared accepted events and presence.

### Security

- cross-tenant and cross-segment object-reference attempts;
- membership escalation and invitation replay;
- inaccessible resource included in AI scope/search/preview/export;
- forged commands and stale revision writes;
- MCP secret serialization checks;
- malicious embed/URL/file content in Website, Dataset, and Document objects.

### Performance and accessibility

- 100 visible/1,000 referenced objects at target latency;
- large Project expansion and session restore;
- concurrent 25-editor soak test;
- keyboard-only creation/delivery flow;
- screen-reader structured graph alternative;
- zoom, 360px responsive review mode, high contrast, and reduced motion.

## 44. Release gates and rollback

### Gate A — internal dogfood

- Durable Session APIs, core objects, and no P0 security defects.
- Daily team usage for two weeks.
- Command/data-loss rate below 0.1%; wrapper-session success ≥ 99%.

### Gate B — opt-in beta

- Dashboard Create tab behind flag.
- P0 requirements complete and P1 collaboration subset stable.
- At least 50 tenant sessions and five multiuser sessions tested.
- Legacy routes remain primary fallback.

### Gate C — navigation default

- Wrapper-session success ≥ 99.9%.
- No unresolved P0/P1 data-loss, permission, or delivery-idempotency defect.
- At least 80% of beta creators successfully return to an existing session.
- Support/onboarding material and five-language catalogs complete.

### Gate D — GA and VSIX

- P1 requirements complete.
- Web/VSIX conformance suite green.
- Capacity, incident, backup/restore, and rollback drills complete.

### Rollback

- Disable `creation_sessions_nav` to restore existing primary navigation.
- Keep Session data/API intact; never delete new data during rollback.
- Legacy routes continue to open their original surfaces while Session links remain accessible by direct URL.
- Disable individual object kinds or AI commands through registry/capability flags.
- Delivery kill switch blocks new mutations while preserving read-only session access.

## 45. Dependencies and ownership

| Workstream | Primary owner | Dependencies |
| --- | --- | --- |
| Session schema/API/events | Platform/API | tenancy, RBAC, migrations, artifact storage |
| Canvas shell/object registry | Frontend | XYFlow, design tokens, accessibility |
| Brain context/commands | Agent Platform | Brain runtime, MCP, model gateway, approvals |
| Project expansion/comparison | PM/Insights | Project 360, metrics/widgets, freshness metadata |
| Artifact delivery | Delivery/Agents | Tasks, assignment, agent runtime, audit |
| Realtime collaboration | Platform | websocket/DO/Yjs infrastructure, presence |
| Dashboard and onboarding | Growth/App Shell | onboarding state, dashboard tabs, previews |
| Navigation migration | App Shell | route adapters, telemetry, localization |
| VSIX client | Developer Experience | shared canvas package, webview protocol, theming |
| Security review | Security | permission intersection, redaction, exports, MCP |

## 46. Implementation epics

1. **CS-A — Session foundation:** migration, repository/service, CRUD, membership, events, snapshots.
2. **CS-B — Shared canvas engine:** registry, command schemas, geometry, connections, inspector, composer.
3. **CS-C — Core live objects:** Chat, Workflow, Project, Website/Browser, Note, Agent.
4. **CS-D — Dashboard and onboarding:** Create tab/cards, prompt creation, auto tenant/starter project, tutorial.
5. **CS-E — Project intelligence:** expansion lenses, metric adapters, comparison and roadmap generation.
6. **CS-F — Data and prototype:** Dataset, Chart, Report/Dashboard, WYSIWYG, mockup sets.
7. **CS-G — Collaboration:** membership, presence, comments, activity, stand-up frames.
8. **CS-H — Delivery loop:** artifact persistence, task creation/link, assignment, approvals, streamed results.
9. **CS-I — Navigation migration:** session menus, legacy wrappers, feature flags, telemetry-gated removal.
10. **CS-J — VSIX:** shared package extraction, native session editor, editor-native objects, conformance tests.

Each epic must ship schema/API/types/tests/localization/telemetry together; no UI-only object is considered live until its authoritative adapter and permission behavior are implemented.

## 47. Definition of Done

This PRD is implemented when:

- Every P0 and P1 requirement has a linked issue, owner, automated acceptance coverage, and completed rollout gate.
- Dashboard Create is the default tab and new prompts create durable sessions.
- Users can create without a Project, add/compare Projects later, and deliver artifacts through Tasks and Agents.
- Core application resources use one registry and canonical APIs on the canvas.
- Cross-object AI outputs contain inspectable sources and safe change previews.
- Multiplayer collaboration and permissions pass security/concurrency testing.
- Brain Storm, Workflows, and IDE/Builder are removed from primary navigation with compatibility routes operating at the required success rate.
- Web and VSIX open the same sessions and pass the shared conformance suite.
- Migration, rollback, support, analytics, localization, accessibility, performance, and operational runbooks are complete.
- No known P0/P1 security, data-loss, tenant-isolation, idempotency, or accessibility defects remain.

## 48. Implementation closure and release evidence (2026-08-01)

The product implementation described by this PRD is complete in the repository. Production rollout remains an operational gate: it can only be attested after the deployed internal/opt-in soak and telemetry thresholds in `docs/design/creation-canvas/OPERATIONS.md` have passed.

| Requirement | Implementation evidence |
| --- | --- |
| CS-001–CS-005 | Tenant-optional session creation, local guest snapshots, claim-on-auth, revisioned graph persistence, geometry/connection commands, and scoped composer in `api/src/application/creation/creationSessionRouteService.ts`, `frontend/src/lib/creationSessions.ts`, and `frontend/src/components/creation-canvas/CreationCanvas.tsx`. |
| CS-006–CS-008 | Shared typed registry, live renderers/inspectors, canonical resource saves, idempotent command batches, snapshots, restore, and conflict reconciliation in `frontend/src/components/creation-canvas/creationObjectRegistry.ts`, `CreationNode.tsx`, and migrations 0388–0390. |
| CS-009–CS-014 | Homepage prompt → local Session, Dashboard Create cards, `/create/new`, compatibility adapters, intersection authorization, and project-independent onboarding in the homepage, dashboard, route adapters, API route service, and Creation Canvas tutorial. |
| CS-015–CS-016 | Invitations/roles, presence/cursors/selections, comments/mentions/activity plus the complete creation object catalog in the API route service and canvas registry. |
| CS-017–CS-023 | Project lens expansion, cited multi-project comparison, persistent evaluations, selectable AI change sets, artifact/task/Agent delivery, top-feature Mockup Sets, Roadmaps, and Slides in `CreationCanvas.tsx` and canonical project/task/runtime clients. |
| CS-024–CS-026 | Viewer/Commenter/Editor/Runner/Owner roles, consolidated primary navigation with legacy URL adapters, Edge route registration, and native VSIX full-editor Creation Sessions in `clients/vscode/src/creationCanvasPanel.ts`. |
| CS-027 | Presentation mode, opt-in collaborator viewport follow, named checkpoints, revision restore, and personal viewport persistence in `CreationCanvas.tsx` and the history/presence APIs. |
| CS-028 | Six capability-safe Marketplace session/object packs (Campaign, Product discovery, Data story, Stand-up, Evermind model lab, Executive review) in `creationTemplates.ts`, surfaced from the in-canvas template library. |
| CS-029 | Real pointer-based freehand paths, editable stroke controls, spatial frames, frame colors/purpose, and private reusable frame presets in `CreationCanvas.tsx`, `CreationNode.tsx`, and canvas CSS. |
| CS-030 | Durable independent Session branches and an explicit per-object branch/parent resolution panel before revision-checked merge into the parent. |

### Cross-cutting evidence

- **Edge/runtime:** `/create/[sessionId]`, `/create/new`, and `/creation-canvas` declare the Edge runtime and pass production build registration.
- **Security/data integrity:** tenant/member checks, canonical-resource access intersection, idempotency keys, If-Match revision handling, additive migrations, snapshots, and rollback guidance are implemented and covered by API/schema/tenant-scope suites.
- **Accessibility:** keyboard selection/deletion, accessible object palette and controls, explicit labels, structured canvas outline, reduced visual chrome in presentation mode, and responsive mobile inspector/composer behavior are present.
- **Analytics:** creation product signals use the shared activity queue and omit prompt/object content; server event/snapshot history supplies operational revision and command evidence.
- **Localization:** the marketing entry flow is updated in all five catalogs; fixed terminology and locale formatting requirements remain enforced by the catalog parity tests and existing internationalization layer.
- **Operations:** deploy, smoke, observation, rollout, support, and rollback procedures live in `docs/design/creation-canvas/OPERATIONS.md`.
- **Marketing:** the homepage, feature catalog, Product mega-menu/specifications, dedicated `/creation-canvas` page, and Creation Canvas launch article set reflect the unified Session model.
