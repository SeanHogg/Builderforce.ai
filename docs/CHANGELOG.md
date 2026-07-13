# Changelog

All notable changes to this project will be documented in this file.

### [Unreleased]

- **progressPct=100 emission rule clarification**: Updated documentation to describe that `progressPct=100` is emitted once, only after all processing steps are complete and no further progress updates will follow. This is the authoritative signal of task/job completion for progress-stream consumers. See `docs/api/event-payload.schema.json` and `docs/guides/progress-handling.md`. (task #672)

---

*Note on AMO rules:* A change to an existing rule may qualify for an AMO. Consult the product team to decide if this change requires an AMO and adjust the title above accordingly.