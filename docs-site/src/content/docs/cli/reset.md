---
summary: "CLI reference for `coderclaw reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `coderclaw reset`

Reset local config/state (keeps the CLI installed).

```bash
coderclaw reset
coderclaw reset --dry-run
coderclaw reset --scope config+creds+sessions --yes --non-interactive
```
