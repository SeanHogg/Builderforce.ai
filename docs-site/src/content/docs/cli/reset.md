---
summary: "CLI reference for `builderforce reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `builderforce reset`

Reset local config/state (keeps the CLI installed).

```bash
builderforce reset
builderforce reset --dry-run
builderforce reset --scope config+creds+sessions --yes --non-interactive
```
