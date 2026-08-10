# Creation delivery architecture

The product flow is **Imagine → Create → Deliver**. A Creation Session owns the conversation and graph; Projects are optional context; canonical services own execution and published artifacts.

## Agent conversation

1. The Chat object is lazily linked to a canonical Brain chat (`chat:<id>`).
2. Agent objects linked to Chat must carry a canonical workforce ref (`agent:<ref>`) to participate as deployed agents.
3. The current user turn is persisted in that chat before any agent runs.
4. `@AgentName` addresses one participant. Unaddressed and “ask all” turns address every connected agent.
5. Agent replies run concurrently through `/api/brain/chats/:id/agent-reply`. That path supplies the triggering user's permissions, the agent's configured model/tools, usage accounting, trace, audit provenance, and project Evermind behavior.
6. Canvas Brain receives the attributed replies as synthesis context and owns the final graph change set.

Guest Canvas personas may assist with local ideation, but they are explicitly not canonical workforce participants.

## Deliverable contract

Every executed output appends a `CreationDeliverable` to its source object's `deliverables` array. The record has:

- stable `id`, `action`, and `artifactKind`;
- `running | delivered | failed` terminal lifecycle;
- provider and canonical resource reference;
- URL/file metadata where applicable;
- validation result and bounded operational metadata;
- correlated Creation outcome events (`started` plus a terminal phase).

Adapters live outside the Canvas component in `frontend/src/lib/creationDeliverables.ts`. Canvas coordinates selection, permissions, locks, and UI state; the adapter builds or calls the actual artifact service.

Currently connected delivery adapters:

| Canvas object/action | Canonical execution | Delivered result |
| --- | --- | --- |
| Website / publish | IDE static-site publish | versioned live URL, path URL, asset proof |
| Video / generate | published Evermind media model | generated frame sequence, first-frame preview, model/usage proof |
| Workflow / run | canonical workflow runtime | workflow run id and terminal status |
| Mockup / deliver | canonical project task | task resource linked to project/agent |
| Document / Word | Office export service | downloaded `.docx` |
| Slides / PowerPoint | Office export service | downloaded `.pptx` |

New operational actions are not complete until they have a real adapter, a terminal deliverable record, an outcome correlation, and a journey test.
