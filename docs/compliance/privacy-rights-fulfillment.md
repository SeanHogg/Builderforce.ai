# Privacy rights fulfillment and retention runbook

Requests cover access/export, correction, deletion, portability, restriction, objection/opt-out, automated-decision review, and appeal. Public requests require proportionate identity verification; authenticated requests are verified by the session. Log jurisdiction, deadline, search scope, decision, fulfillment evidence, processor status, backup disposition, and reviewer.

1. Acknowledge and calculate the shortest applicable deadline; pause only where law permits verification clarification.
2. Locate identity, workspace, chat/message, artifact, billing, support, security, marketing, integration, telemetry, and legal records. Export in intelligible JSON plus native artifact formats.
3. Correction updates the source of truth and downstream searchable copies. Deletion removes or irreversibly anonymizes live data unless a documented legal/security exception applies.
4. For every enabled processor, send the applicable access/correction/deletion instruction, record its request identifier and completion, and escalate failures. Do not mark complete while a required processor is merely queued.
5. Backups are encrypted, access restricted, excluded from ordinary use, and expire under the backup schedule. If restored for disaster recovery, replay deletion tombstones before resuming normal processing.
6. A different reviewer decides appeals and provides reasons plus the applicable attorney-general or regulator complaint route.

Quarterly test: create a synthetic user with chat, idea, integration, and billing metadata; export; correct; delete; verify processor ledger; attempt restore/search; appeal a simulated denial; retain the evidence bundle.
