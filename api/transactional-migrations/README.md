# Transactional database

These migrations target `NEON_TRANSACTIONAL_DATABASE_URL`, a separate Neon
account for disposable operational records. Tables here must not declare foreign
keys to the primary database. Tenant, project, task, user, agent, chat, incident,
and support-ticket identifiers are intentionally stored as unenforced scalar IDs.

Run both migration tracks with `npm run db:migrate`. No historical operational
data is copied from the primary database.
