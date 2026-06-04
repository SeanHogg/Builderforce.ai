---
title: "HEARTBEAT.md Template"
summary: "Workspace template for HEARTBEAT.md"
read_when:
  - Bootstrapping a workspace manually
---

# HEARTBEAT.md

# Keep this file empty (or with only comments) to skip heartbeat API calls.

# Add tasks below when you want the agent to check something periodically.

## Built-in Monitoring Tasks (Do not edit manually)

### Context Window Management

- Track memory file sizes (SOUL.md, USER.md, .builderforce/memory/\*.md)
- If any file exceeds 50KB, trigger pruning: compress old entries, archive to .builderforce/memory/archive/
- Prune when total memory overhead >20% of estimated context budget

### Conflict Detection

- On session startup, scan SOUL.md, USER.md, .builderforce/\*.yaml for merge conflict markers
- If conflicts found: pause, report, propose resolution, ask for confirmation
- Never proceed with conflicted files

### Preference Inference

- Every 10 interactions, review USER.md for implicit preference signals
- Update "Learned Preferences" section with inferred patterns
- Re-evaluate and prune outdated preferences monthly
