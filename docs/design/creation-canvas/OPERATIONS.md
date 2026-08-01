# Creation Canvas operations

## Deploy

1. Back up the production database and record the current API/frontend/VSIX versions.
2. From `api`, run `npm run check:migrations`, `npm run check:schema`, `npm run check:tenant-scope`, and `npm run typecheck:native`.
3. Run `npm run db:migrate` before deploying the API. This applies `0388` through `0393` in order, fixes older environments that lack collaboration columns, adds completion/search/limit state, creates hashed expiring invitations, and installs the Session-owned conversation timeline.
4. Deploy the API, then the frontend, then package/publish the VSIX. The older clients remain compatible with the additive schema.
5. Smoke-test anonymous homepage prompt → local canvas → sign-in claim, server autosave, invitation/presence, history restore, project expansion, Agent delivery, and the native VSIX editor against one disposable session.
6. Smoke-test the advanced collaboration gate: Marketplace pack placement, freehand drawing, custom-frame save/reuse, presentation mode, collaborator follow, named checkpoint, branch creation, reviewed merge, and recovery from a deliberately stale parent revision.
7. Verify the public `/creation-canvas` specification page and all five launch/use-case articles are present in the generated sitemap and social metadata.

## Observe

- Alert on creation-session 5xx, command conflicts/rejections, permission denials, snapshot growth, presence/WebSocket failures, wrapper failures, and delivery duplication.
- Verify `/create/:sessionId` is served by the Edge runtime and that `last_seen_at`, snapshot, viewport, cursor, selection, typing, and pinned columns exist.
- Track legacy wrapper success before removing fallback code.
- Track the PRD product-event family (`creation_session_*`, `creation_prompt_submitted`, `creation_object_*`, `creation_connection_added`, `creation_project*`, `creation_ai_evaluation_completed`, `creation_change_set_applied`, `creation_artifact_delivered`, `creation_agent_assigned`, `creation_tutorial_step_completed`, and `creation_legacy_route_adapted`) without recording prompt or object content.
- Alert when a branch merge returns a revision conflict; the reviewer must refresh and repeat object resolution rather than silently overwriting the parent.

## Rollout gates

1. Internal tenants: two-week daily-use soak with command/data-loss rate below 0.1%, wrapper-session success ≥ 99%, and no P0/P1 tenant-isolation, data-loss, command-idempotency, accessibility, or presence defect.
2. Opt-in tenants: at least 50 tenant Sessions and five multiplayer Sessions; session API 5xx < 0.5%, command rejection/conflict within the established baseline, and no sustained preview queue or presence lag alert.
3. Default navigation: enable `creation_sessions_nav` only after web and the current VSIX pass the shared session smoke suite.
4. Legacy menu removal: keep compatibility URLs and rollback controls for at least one full supported client window.

## Repository release-candidate evidence — 2026-08-01

- API: TypeScript and all schema, migration, layering, tenant-scope, source, dispatch, and prompt-tool ratchets pass; 400 test files and 4,347 tests pass (one environment-specific test skipped).
- Web: TypeScript, 78 test files/768 tests, and the optimized Next production build pass. `/create`, `/create/new`, `/create/[sessionId]`, `/create/invitations/[token]`, and `/creation-canvas` register as dynamic Edge surfaces.
- VSIX: extension and native webview production bundles compile; 23 tests pass against the shared Creation Canvas object/command contract.
- Acceptance project: `qa-e2e/tests/creation-canvas.spec.ts` typechecks and is ready for the deployed authenticated/local-first smoke environment.
- Database repair: migrations 0388 and 0389 both define the presence `last_seen_at` column with forward-compatible guards, and schema drift verification passes.

## Support playbook

- **Guest draft does not claim:** preserve the local-storage snapshot, confirm a tenant token exists, retry claim with the same idempotency key, and never clear the guest key until the saved session opens successfully.
- **Session reports missing `last_seen_at`:** confirm migrations 0388–0393 were applied in order—especially the forward-compatible `0389` repair—and run schema checks before restarting presence traffic.
- **Conversation is missing after Chat removal:** confirm `0393_creation_session_timeline.sql` is applied, verify `/api/creation-sessions/:id/timeline`, and do not reconstruct the authoritative transcript from Chat Object content.
- **Realtime disconnect:** keep local geometry edits queued, display reconnecting state, and reconcile against the latest server revision before resuming autosave.
- **Referenced object is redacted:** verify both session membership and the canonical resource permission. Never broaden resource access merely because the session was shared.
- **Merge conflict:** reopen the parent, rerun comparison, and require a fresh object-by-object review. Do not force a stale graph replacement.
- **Large session performance:** collapse heavy live objects, organize them into frames, or branch/split into a linked session; preserve canonical artifact references rather than embedding large payloads.

## Roll back

- Roll back clients/API first; the migrations are additive and remain safe for older code.
- Do not drop Creation Session tables or columns during an incident. Preserve sessions, snapshots, comments, and event history for recovery.
- If command writes are unhealthy, disable the Creation navigation rollout and use legacy compatibility surfaces while retaining read access to existing sessions.
- Restore the database only for verified corruption or data loss, never for an ordinary application rollback.
