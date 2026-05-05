---
title: Knowledge Loop
description: How CoderClaw builds and maintains a persistent project memory — daily markdown logs, semantic querying, and Builderforce sync
---

# Knowledge Loop

The knowledge loop is CoderClaw's mechanism for accumulating project memory across sessions. Rather than starting each session cold, CoderClaw maintains a rolling record of decisions, discoveries, and patterns — and injects the relevant context into new sessions automatically.

---

## How it works

The `KnowledgeLoopService` runs as a sidecar alongside the gateway. At the end of each session, it:

1. Extracts significant facts from the session (architectural decisions, bugs found and fixed, patterns established, things to avoid)
2. Appends them to a daily markdown log under `.coderClaw/memory/`
3. Syncs the log to Builderforce (if connected) so the memory is available across machines

At the start of each new session, the orchestrator loads the most recent memory entries as context.

---

## Memory files

Memory is stored as daily markdown files:

```
.coderClaw/
  memory/
    2026-03-21.md
    2026-03-20.md
    2026-03-19.md
```

Each file contains entries written during that day's sessions:

```markdown
# 2026-03-21

## Session wf-planning-20260321-095412

- **Decision**: Use Drizzle ORM for all database access — no raw SQL except in migration files.
- **Discovery**: The `users` table has a composite unique index on `(tenantId, email)` — queries must include `tenantId` to use the index.
- **Pattern**: Approval gate responses arrive via relay WebSocket as `approval.decision` frames, not via polling.
- **Avoid**: Do not use `db.execute()` directly — it bypasses the tenant isolation filter.
```

---

## Querying memory

Search the memory files for past decisions and discoveries:

```bash
# Find all entries mentioning a topic
grep -r "Drizzle" .coderClaw/memory/

# Entries from the last 7 days
ls -t .coderClaw/memory/*.md | head -7 | xargs cat

# All "Avoid" entries (anti-patterns)
grep -h "**Avoid**" .coderClaw/memory/*.md
```

The memory CLI command provides structured access:

```bash
coderclaw memory list                   # list recent entries
coderclaw memory search "database"      # full-text search
coderclaw memory show 2026-03-21        # show a specific day
```

---

## Builderforce sync

When connected to Builderforce, memory files are synced to the portal as part of the workspace directory sync. This means:

- Memory entries written on one machine are available when the claw restarts on another
- The portal's workspace view shows the current memory state alongside other project files
- Memory entries appear in the tool audit log as `knowledge_loop.write` events

Sync happens automatically via the existing directory sync mechanism — no additional configuration is required.

---

## What gets recorded

The knowledge loop focuses on **non-obvious, durable facts** about the project:

| Entry type | Example |
|-----------|---------|
| Architectural decision | "All auth tokens stored in `httpOnly` cookies, not `localStorage`" |
| Bug or root cause | "The 401 errors were caused by clock skew between the claw and the API — JWT `iat` was in the future" |
| Established pattern | "Feature flags controlled via `feature_flags` table, not environment variables" |
| Anti-pattern | "Do not call `buildContext()` twice in the same request — it hits the DB each time" |
| Constraint | "The `events` table is append-only — updates and deletes are blocked at the DB level" |

The knowledge loop does **not** store:
- Transient state (current task status, who is working on what)
- Information already derivable from reading the code
- Git history summaries (use `git log` for that)

---

## Retention

Memory files are never auto-deleted by CoderClaw. Prune old files manually:

```bash
# Delete files older than 90 days
find .coderClaw/memory -name "*.md" -mtime +90 -delete
```

At session start, only the most recent memory entries (last 7 days by default, configurable) are loaded as context. Older files are available for manual review but are not injected automatically.

### Configuration

```json5
{
  knowledgeLoop: {
    enabled: true,           // default true
    retentionDays: 7,        // how many days of memory to inject at session start
    maxEntriesPerSession: 20 // max entries extracted per session
  }
}
```

---

## Standalone mode (no Builderforce)

The knowledge loop works fully in standalone mode — memory is written locally and loaded from local files. Builderforce sync is simply skipped when no connection is configured.

```
[knowledge-loop] No Builderforce connection — memory sync disabled
```

---

## Troubleshooting

**Memory entries not appearing in new sessions**

- Check that `knowledgeLoop.enabled` is `true` in config.
- Verify `.coderClaw/memory/` contains files from recent sessions.
- Check `retentionDays` — if set to 1, only today's entries load.

**Too much noise in memory (irrelevant entries)**

- Review recent memory files and delete entries manually.
- The knowledge loop extraction is conservative by design, but occasionally captures transient observations. Delete the line from the markdown file directly.

**Memory not syncing to portal**

- Check `CODERCLAW_LINK_URL` and `CODERCLAW_LINK_API_KEY`.
- Memory sync goes through the directory sync mechanism — check for `[dir-sync]` errors in `coderclaw logs`.
