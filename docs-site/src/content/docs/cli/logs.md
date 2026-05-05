---
summary: "CLI reference for `coderclaw logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `coderclaw logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
coderclaw logs
coderclaw logs --follow
coderclaw logs --json
coderclaw logs --limit 500
coderclaw logs --local-time
coderclaw logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
