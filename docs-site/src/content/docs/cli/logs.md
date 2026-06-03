---
summary: "CLI reference for `builderforce logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `builderforce logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
builderforce logs
builderforce logs --follow
builderforce logs --json
builderforce logs --limit 500
builderforce logs --local-time
builderforce logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
