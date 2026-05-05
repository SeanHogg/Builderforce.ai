---
summary: "CLI reference for `coderclaw health` (gateway health endpoint via RPC)"
read_when:
  - You want to quickly check the running Gateway’s health
title: "health"
---

# `coderclaw health`

Fetch health from the running Gateway.

```bash
coderclaw health
coderclaw health --json
coderclaw health --verbose
```

Notes:

- `--verbose` runs live probes and prints per-account timings when multiple accounts are configured.
- Output includes per-agent session stores when multiple agents are configured.
