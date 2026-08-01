# Creation Canvas operations

## Deploy

1. Back up the production database and record the current API/frontend/VSIX versions.
2. From `api`, run `npm run check:migrations`, `npm run check:schema`, `npm run check:tenant-scope`, and `npm run typecheck:native`.
3. Run `npm run db:migrate` before deploying the API. This applies `0388`, `0389`, and `0390` in order and fixes older environments that lack collaboration columns.
4. Deploy the API, then the frontend, then package/publish the VSIX. The older clients remain compatible with the additive schema.
5. Smoke-test anonymous homepage prompt → local canvas → sign-in claim, server autosave, invitation/presence, history restore, project expansion, Agent delivery, and the native VSIX editor against one disposable session.

## Observe

- Alert on creation-session 5xx, command conflicts/rejections, permission denials, snapshot growth, presence failures, wrapper failures, and delivery duplication.
- Verify `/create/:sessionId` is served by the Edge runtime and that `last_seen_at`, snapshot, viewport, cursor, selection, typing, and pinned columns exist.
- Track legacy wrapper success before removing fallback code.

## Roll back

- Roll back clients/API first; the migrations are additive and remain safe for older code.
- Do not drop Creation Session tables or columns during an incident. Preserve sessions, snapshots, comments, and event history for recovery.
- If command writes are unhealthy, disable the Creation navigation rollout and use legacy compatibility surfaces while retaining read access to existing sessions.
- Restore the database only for verified corruption or data loss, never for an ordinary application rollback.
