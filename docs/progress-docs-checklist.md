# Progress Documentation Checklist

This checklist is used to verify that all documentation assets related to `progressPct` and progress event emission are consistent, complete, and aligned with the canonical rule.

## Canons: The Central `progressPct=100` Rule

From the implementation in `ChatTicketService.ts` and the API reference:

> **Rule**: `progressPct=100` is emitted **ONLY ONCE**, **AFTER** ALL processing steps are confirmed complete, with **NO** further progress updates following. This is the authoritative signal of task/job completion for progress-stream consumers.

All documentation must adhere to this rule without deviation.

## Documentation Inventory

| Asset | Location | Should Contain | Status |
|-------|----------|----------------|--------|
| API Reference | `docs/api/event-payload.schema.json` | JSON Schema definition with `progressPct` field, `=100` boundary condition, and examples | ✅ |
| Developer Guide | `docs/guides/progress-handling.md` | Integration pattern, code examples, cleanup on 100%, warning about 99% | ✅ |
| Changelog | `docs/CHANGELOG.md` | Clear description of the rule clarification or change, dated entry | ✅ |
| Inline Comments | `api/src/application/brain/ChatTicketService.ts` | JSDoc/TSDoc describing `progressPct` semantics (already present) | ✅ |
| Frontend Types | `packages/brain-ui/src/chatTickets/types.ts` | TypeScript interface for progress events (already present) | ✅ |
| README | `README.md` | Brief summary if progress tracking is a key feature | ⚠️ (needs manual check) |
| CONTRIBUTING | `CONTRIBUTING.md` | If progress APIs are public, mention about handling 100% | ⚠️ (needs manual check) |

## Verification Checklist

### API Reference (`event-payload.schema.json`)

- [ ] Contains a `progressPct` field description that explicitly states the `=100` boundary condition
- [ ] Notes the ordering guarantee (`=100` is terminal, no further values follow)
- [ ] Includes concrete JSON examples with `"progressPct": 100`
- [ ] Distinguishes `progressPct=100` from other status fields where relevant

### Developer Guide (`progress-handling.md`)

- [ ] Code examples show progress listener registration
- [ ] Code examples demonstrate cleanup (unsubscribe/remove handler) upon receiving `progressPct=100`
- [ ] Warns against treating intermediate values (e.g., 99) as completion
- [ ] Describes the correct pattern for tearing down listeners
- [ ] Explains the terminal guarantee and single-emission property

### Changelog (`CHANGELOG.md`)

- [ ] Entry is dated with a clear date (format: `YYYY-MM-DD` or ISO date)
- [ ] Identifies this as a behavioral rule clarification or change (as appropriate)
- [ ] States any previous ambiguity or behavior
- [ ] Describes what developers must verify or update in their integrations

### Inline Comments / JSDoc

- [ ] All `progressPct` fields in source code have JSDoc/TSDoc explaining the `=100` semantics
- [ ] No contradictory comments on whether 100 can be emitted multiple times

### Consistency Queries

To verify no contradictory descriptions:

**Search across all in-scope docs for:**

- [ ] `"progressPct"` appears in multiple contexts – confirm they all use consistent terminology
- [ ] `"100%"` appears without explicit connection to the `progressPct` field – verify it aligns with the rule
- [ ] Phrases like "emitted once" or "terminal signal" – ensure they are not contradicted by other sections
- [ ] Phrases like "may be emitted multiple times" – must NOT appear unless explicitly describing an exception (there is none)

Run searches like:

- `progressPct 100`
- `progressPct=100`
- `"100%"` (controlled context)
- `emitted.*once` or `emitted.*multiple` (to catch edge language)

### Frontend / Client Code

- [ ] Type definitions for progress events include the field
- [ ] UI components that display progress respect the 100% signal as completion
- [ ] Cleanup is present (unsubscribing from progress stream) when 100% is detected

## Cross-Asset Terminology Alignment

Use these terms consistently:

| Term | Definition | Applied Here |
|------|------------|--------------|
| `progressPct` | Number field 0–100 on progress events | ✅ |
| `=100` | The boundary condition (only when terminal) | ✅ |
| Single emission | `progressPct=100` sent only once | ✅ |
| Terminal signal | No further progress events after 100% | ✅ |
| Completion signal | `progressPct=100` indicates true completion | ✅ |
| Intermediate value | Any value <100 that may be followed by updates | ✅ |

**Do not mix with:**
- "100%" (without reference to the field) – only use when describing progress display
- "Done" (human-readable status) – distinction from the programmatic signal

## Automated Checks (to run when updating docs)

```bash
# Search for contradictions
grep -r "progressPct" docs/
grep -r "=100" docs/ | grep -i "emit\|multiple\|redundant"
grep -r "emitt.*multiple" docs/

# Check for missing examples
# (manual verification)
```

## Red Lines (things that must NOT exist)

- ❌ Any statement that `progressPct=100` may be emitted before task completion
- ❌ Any statement that 100 may be emitted more than once
- ❌ Any implication that intermediate values (e.g., 99) are completion signals (except in examples showing the correct SW to TREAT 100 as the real signal)
- ❌ Contradiction between API reference and developer guide on behavior
- ❌ Outdated behavior descriptions referring to older implementation (e.g., before the new rule)

## When to Update This Checklist

- [ ] When new progress-related assets are added to the repo
- [ ] When API contracts change (changes to `progressPct` semantics)
- [ ] When resolving issues or feedback that reveals documentation inconsistencies
- [ ] Before merging a PR that updates progress-related code

---

**Owner**: Technical Writers / Backend Team
**Frequency**: Once per progress-related PR
**Tool**: Used by Reviewer to confirm AC-1, AC-5, AC-6 from the PRD (#672)