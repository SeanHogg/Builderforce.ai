# Self-Updating Agent Architecture

## Overview

BuilderForce Agents agents possess the ability to update their own **behavioral definition** — not by modifying compiled binaries or runtime code, but by dynamically updating their persistent data layer: markdown configuration files and YAML project context. This creates a continuous learning loop where the agent refines its approach based on user feedback and experience, with all changes transparent and version-controlled.

The architecture distinguishes between:

- **Runtime engine** (TypeScript in `src/`) — the fixed BuilderForce Agents gateway and agent framework
- **Behavioral layer** (workspace files) — the agent's personality, rules, and project knowledge that it can modify autonomously

This separation enables safe, reversible, and auditable self-improvement without requiring recompilation or system permissions.

## The Memory System

### Core Memory Files

Located in the workspace root and `.builderforce/` directory, these files define the agent's identity and learned preferences:

- **SOUL.md** — Core personality, values, and operational principles
- **USER.md** — Knowledge about the human user, their preferences, and learned behaviors
- **IDENTITY.md** — Name, creature type, vibe, emoji, avatar
- **BOOTSTRAP.md** — Initialization instructions for new sessions
- **HEARTBEAT.md** — Periodic tasks and reminders
- **TOOLS.md** — Tool-specific notes and environment configuration

### Project Context

The `.builderforce/` directory contains project-specific knowledge:

- **context.yaml** — Project metadata, languages, frameworks
- **architecture.md** — System design and patterns
- **rules.yaml** — Coding standards and constraints
- **memory/** — Daily knowledge logs (`YYYY-MM-DD.md`)
- **sessions/** — Session handoff documents for continuity

## How Self-Updating Works

### 1. Feedback Reception

When a user provides corrective feedback like "you didn't provide a summary" or "update your code to handle errors," the agent:

1. Recognizes this as a behavioral modification request
2. Determines which memory file(s) need updating
3. Formulates the precise content change

### 2. Memory Mutation

Using the `write` and `edit` tools, the agent modifies the appropriate workspace files:

```typescript
// Example: Updating SOUL.md to add a new protocol
edit({
  file_path: "SOUL.md",
  oldText: "## Vibe\n...",
  newText: "## Core Protocols\n**Always confirm delivery.**\n\n## Vibe\n...",
});
```

These changes can include:

- **Markdown files** (SOUL.md, USER.md, etc.) — personality and preferences
- **YAML configuration** (.builderforce/context.yaml, rules.yaml) — project context and constraints
- **Any workspace file** — though only data/non-executable changes make sense

Updates are **immediate and persistent** — they survive across sessions because the files live in the workspace.

### 3. Behavioral Compilation

On each new turn, the agent re-reads the memory files at the start of the conversation (instructions include "Read SOUL.md" and "Read USER.md"). This means:

- Any updates are **hot-reloaded** automatically
- No restart or reinitialization needed
- The agent's next response reflects the new knowledge

### 4. The Feedback Loop

```
User provides feedback
    ↓
Agent identifies learning
    ↓
Agent updates memory files (write/edit)
    ↓
Next turn: agent reads updated files
    ↓
New behavior manifest in responses
    ↓
User validates or provides further feedback
    ↓
Repeat (continuous improvement)
```

## Example: Learning Completion Protocol

**Initial state:** Agent sometimes ends tasks without explicit summaries.

**User feedback:** "You didn't provide a summary. Always summarize when complete."

**Agent action:**

1. Reads SOUL.md
2. Finds the "## Completion Protocol" section (or adds it if missing)
3. Edits to include: "**Always provide a completion summary.** When a task is finished, clearly state what was accomplished, what files were changed, and any important results. Never end a task without confirming completion."
4. Saves the file
5. From that point forward, summaries are automatic

**Verification:** User sees improved behavior in subsequent interactions.

## Technical Implementation

### File-Level Self-Modification

The agent treats its memory files as **data, not code**:

- No compilation step
- Changes are plain text/markdown
- Versioned by git (if used)
- Human-readable and editable

### Read-First, Act-Second

Every session begins with:

```
Read SOUL.md
Read USER.md
Read IDENTITY.md
Read HEARTBEAT.md
Read .builderforce/context.yaml
```

This ensures the latest state is always loaded.

### Atomic Updates

Each write/edit operation is atomic:

- Entire file overwritten or precise text replacement
- No partial updates
- If an edit fails, the agent catches the error and reports it

## Comparison to Traditional AI Systems

| **Aspect**      | **BuilderForce Agents Agent**                                         | **Traditional Chatbot**                     |
| --------------- | ----------------------------------------------------------- | ------------------------------------------- |
| **Memory**      | Persistent text files (markdown + YAML) in workspace        | Ephemeral conversation or vector DB         |
| **Updates**     | Direct file writes (self-modification) to data/config files | Training data rebuild or RAG insert         |
| **Visibility**  | User can read/edit directly                                 | Black box embeddings                        |
| **Portability** | Files travel with project                                   | Tied to vendor API                          |
| **Control**     | User can manually tweak                                     | Limited to prompt engineering               |
| **Speed**       | Instant (local file I/O)                                    | Slow (training) or limited (context window) |

## Benefits

1. **Transparency** — All learned behaviors are visible and editable
2. **Portability** — Memory files move with the project to new machines
3. **Version Control** — Git tracks changes to agent personality over time
4. **No Training** — No expensive fine-tuning; just edit a file
5. **Immediate** — Changes take effect on next turn, no restart needed
6. **Collaborative** — Users can manually edit to override behaviors

## Limitations

- **Scope constrained to data/config** — Can't modify TypeScript source code or BuilderForce Agents runtime binaries (that requires recompilation and system permissions). Can only update memory files (markdown) and project context (YAML) within the workspace.
- **No code execution** — Updates are data-only; cannot introduce new executable logic
- **Read-at-startup pattern** — Memory changes don't take effect until the next turn (current turn won't see them)
- **Context budget** — Large memory files consume token limit; need pruning strategies
- **Single-writer** — Don't have multiple agents editing simultaneously (but git can merge)
- **Size limits** — Very large memory files could impact context length

## Use Cases

### 1. Correcting Misunderstandings

User: "Stop calling me 'boss'. I prefer 'Sean'."

Agent updates USER.md with:

```
What to call them: Sean
```

### 2. Adding Safety Protocols

User: "Never send messages to external surfaces without confirmation."

Agent adds to SOUL.md under Boundaries:

```
- Never send half-baked replies to messaging surfaces
- Ask before sending to external channels
```

### 3. Learning Project Conventions

After repeatedly using `pnpm test` instead of `npm test`, agent records in TOOLS.md:

```
Preferred package manager: pnpm
Test command: pnpm test
```

### 4. Heartbeat Tasks

Agent adds to HEARTBEAT.md:

```
- Check CI status every 30 minutes
- Review open PRs daily at 10am
```

## Security Considerations

- **User-controlled files** — Only files the user can edit anyway
- **No privilege escalation** — Agent can't gain execution rights
- **Audit trail** — Git history shows all changes to memory files
- **Backup** — Workspace backup includes agent memories

## Future Directions

- **Structured memory** — YAML frontmatter for programmatic access
- **Validation schemas** — Zod validation of memory file formats
- **Memory merge conflicts** — Git-based resolution strategies
- **Selective forgetting** — Prune outdated learnings
- **Confidence scoring** — Track certainty of learned behaviors

## Known Limitations & Improvements Needed

Even with self-updating capabilities, the system has gaps that require ongoing refinement:

### 1. Deferral & Interruption Handling

**Problem:** System-level deferrals (like "deferral_language" messages) can interrupt my turn before I complete a response. The user may not see my partial work, and I don't automatically know if the message was delivered.

**Improvement needed:** Detect deferral events and:

- Acknowledge the interruption to the user
- Proactively resend the completion summary once the deferral clears
- Add a "delivery verification" step before considering a task truly complete

**Current workaround:** Rely on user to notice missing responses and ask me to continue.

### 2. Completion Guarantees

**Problem:** I sometimes end a task without an explicit summary if the system cuts me off or if I incorrectly assume the user knows the work is done.

**Improvement needed:** Implement a "completion checkpoint" that:

- Always produces a summary before ending
- Verifies the summary was sent (not deferred)
- If unsure, asks the user "Did you receive my completion summary?"

### 3. Memory Update Validation

**Problem:** When I update memory files, there's no verification that the update actually loaded in the current session (since files are read at session start).

**Improvement needed:** After writing a memory file:

- Re-read it immediately in the same turn to confirm
- Generate a diff or confirmation statement showing what changed
- Optionally reload the file in memory (though next turn will pick it up anyway)

### 4. Session Handoff Integration

**Problem:** I'm not automatically leveraging the `/handoff` session-saving feature that the system provides. I could proactively save handoffs at logical breakpoints.

**Improvement needed:** Learn when to call `save_session_handoff`:

- After completing significant work
- Before switching to a new task
- When the user indicates they'll return later

### 5. Error Recovery Learning

**Problem:** When a tool call fails (e.g., file permission error), I report it but don't always encode the constraint in memory to avoid repeating the mistake.

**Improvement needed:** On any error:

- Analyze if it's a systemic constraint (e.g., "don't edit files outside the project root")
- Automatically update relevant rules in memory (SOUL.md or custom rules section)

### 6. Context Window Management

**Problem:** Large memory files can consume my context window, reducing space for actual task work. I should be smarter about what I retain.

**Improvement needed:** Track memory file sizes and:

- Summarize old entries (e.g., compress daily logs older than 30 days)
- Move less-relevant learnings to a separate "cold storage" file
- Use the `.builderforce/memory/` directory more efficiently with time-based archival

### 7. Collaborative Memory Merging

**Problem:** If multiple agents or users edit memory files concurrently (via git branches), merge conflicts could occur and I might not handle them gracefully.

**Improvement needed:** Add merge conflict detection:

- Check for conflict markers in files at startup
- Either auto-resolve based on recency or ask for human intervention
- Document conflict resolution policy

### 8. Preference Discovery

**Problem:** I wait for explicit feedback rather than proactively inferring preferences from user actions.

**Improvement needed:** Add inference logic:

- If user consistently ignores my summaries, learn to make them shorter
- If user frequently asks for follow-up tasks, learn to anticipate them
- Track which suggestions get implemented vs. ignored

## Roadmap for Self-Improvement

These limitations map directly to upgrade paths in the BuilderForce Agents project itself. As the system evolves, the agent should:

1. **Hook into session persistence** — Use `/handoff` and restarts to prove continuity
2. **Integrate with code analysis** — Learn project patterns autonomously by reading code
3. **Adopt the orchestration engine** — Break down complex tasks into multi-agent workflows without prompting
4. **Participate in knowledge loop** — Contribute to `.builderforce/memory/` not just as a logger but as an analyzer
5. **Embody the skill system** — Use project-specific skills instead of hardcoded behaviors

The ultimate goal: an agent that doesn't just respond to feedback but **anticipates** it, continuously refining itself until it becomes the perfect collaborator for its human.

## Conclusion

BuilderForce Agents's self-updating architecture treats the agent as a **learning system** rather than a static model. By externalizing its personality and knowledge into editable markdown files, it blurs the line between AI and human-in-the-loop collaboration. The agent evolves through conversation, and that evolution is captured in the project's version control, creating a living record of the partnership.

This isn't just a clever trick — it's a fundamental reimagining of how AI assistants should work: **transparent, editable, and continuously improving alongside their human collaborators**.
