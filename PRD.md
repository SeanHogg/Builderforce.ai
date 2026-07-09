> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #387
> _Each agent that updates this PRD signs its change below._

# PRD: Brain Chat Review & Consolidation — BuilderForce.AI (Project 11)

---

## Problem & Goal

The BuilderForce.AI project (projectId = 11) has accumulated 13 Brain chats, several of which are untitled ("New chat") and presumed to be duplicates, near-duplicates, or superseded conversations. This creates cognitive overhead when navigating project knowledge, risks fragmented context across related discussions, and makes it harder for agents and team members to locate canonical information.

**Goal:** Audit every chat's message content, merge related or duplicate conversations into single, well-titled surviving chats, and eliminate all generic "New chat" titles — without losing any message data.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| **Project Architect / Lead Agent** | Needs a single source of truth per topic when referencing past decisions |
| **Downstream AI Agents** | Rely on Brain chats for project context; duplicate/conflicting chats degrade output quality |
| **Product / Project Manager** | Needs clean, navigable chat history to track what has been decided and discussed |

---

## Scope

This task is scoped exclusively to **Brain chats on projectId = 11** using the four platform tools listed below. No other projects, resources, or systems are in scope.

### In-Scope Tools

| Tool | Purpose |
|---|---|
| `builtin_brain_list({ projectId })` | Enumerate all existing chats |
| `builtin_chats_get_messages({ chatId })` | Read full message transcript of a chat |
| `builtin_chats_consolidate({ targetChatId, sourceChatIds })` | Merge one or more source chats into a target chat |
| `builtin_brain_update({ id, title })` | Rename a surviving chat to a descriptive title |

---

## Functional Requirements

### FR-1 — Enumerate All Chats
- Call `builtin_brain_list({ projectId: 11 })` to retrieve the full list of chat IDs, current titles, and metadata.
- Record all 13 chat IDs before any mutation is performed.

### FR-2 — Read Every Chat's Full Transcript
- For **each** chatId returned in FR-1, call `builtin_chats_get_messages({ chatId })` and capture the full message list.
- A chat is considered **empty** if it contains zero user or assistant messages.
- A chat is considered a **subset** if every substantive topic it covers is also covered — with equal or greater depth — in another chat.

### FR-3 — Topic Grouping
- After reading all transcripts, group chats into topic clusters. Expected candidate clusters include (but are not limited to):
  - PRD / Product Requirements work
  - Agent Creation / Agent architecture
  - PWA (Progressive Web App) design or implementation
  - Generic / empty / stub chats with no substantive content
- Each cluster must have exactly one designated **target chat** (the richest, most complete conversation on that topic).
- All other chats in the cluster become **source chats** to be merged.

### FR-4 — Consolidation
- For each cluster where two or more chats exist, call:
  ```
  builtin_chats_consolidate({ targetChatId: <target>, sourceChatIds: [<source1>, <source2>, ...] })
  ```
- Consolidation must be performed **cluster by cluster**, completing one merge before initiating the next.
- Empty chats (no messages) with no unique content should be merged into the most thematically appropriate target, or into a catch-all target if topic is indeterminate.

### FR-5 — Rename Surviving Chats
- After all consolidations are complete, call `builtin_brain_update({ id: <chatId>, title: <descriptiveTitle> })` for every surviving chat.
- Titles must be:
  - Specific to the topic discussed (e.g., `"PRD: BuilderForce.AI MVP Requirements"`, `"Agent Architecture & Creation Flow"`, `"PWA Design & Implementation"`)
  - Written in title case
  - Free of the string `"New chat"`
  - No longer than 72 characters

### FR-6 — Verification
- After all operations, call `builtin_brain_list({ projectId: 11 })` once more to confirm:
  - Chat count has been reduced (fewer than 13 chats remain, unless all 13 were genuinely distinct)
  - No surviving chat is titled "New chat"

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | No two surviving chats cover the same primary topic | Manual review of final title list + spot-check of transcripts |
| AC-2 | Every surviving chat has a descriptive, meaningful title (no "New chat") | `builtin_brain_list` output contains no title matching "New chat" |
| AC-3 | No message data is lost: all messages from merged source chats are present in the target | Post-consolidation `builtin_chats_get_messages` on each target returns all expected messages |
| AC-4 | All consolidation operations complete without error before any rename is attempted | Sequential execution order enforced; errors halt the process |
| AC-5 | The final `builtin_brain_list` call confirms a reduced, clean chat list | Chat count ≤ number of distinct topic clusters identified in FR-3 |
| AC-6 | Chats identified as empty or stub are either merged or confirmed deleted — not left as orphaned "New chat" entries | No untitled or empty chats remain in the final list |

---

## Out of Scope

- **Other projects**: No Brain chats outside projectId = 11 are touched.
- **Message editing**: The content of individual messages within chats is not modified, summarized, or deleted — only structural consolidation (merge) is performed.
- **Chat deletion without consolidation**: Source chats are only removed as a side-effect of `builtin_chats_consolidate`; standalone deletion tools are not used.
- **New chat creation**: No net-new chats are created as part of this task.
- **External integrations**: No external APIs, databases, or notification systems are involved.
- **Access control or permission changes**: Chat visibility and sharing settings are not modified.
- **Content summarization or AI rewriting**: Titles are descriptive of existing content, not AI-generated summaries injected into chat bodies.