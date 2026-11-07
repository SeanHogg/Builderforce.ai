/**
 * Which `rejected` receipts a resend can NEVER fix.
 *
 * Only these dead-letter an event: the payload itself is invalid (a validation code), or the
 * request is one the server will always refuse. Everything else a server may answer with —
 * `occurred_at_in_future` (the clock will pass), `schema_version_unsupported` (an upgrade lands),
 * `*_unresolved` / `entity_not_imported` (the parent may still arrive), `*_write_failed`, and any
 * code this list does not know — is a HOLD: the event stays pending and is retried after fresh
 * work. An unknown refusal must never silently throw a user's write away.
 */
export const PERMANENT_REFUSALS: ReadonlySet<string> = new Set([
  'payload_invalid',
  'invalid_event',
  'event_id_invalid',
  'depends_on_invalid',
  'client_entity_id_required',
  'payload_hash_mismatch',
  'event_payload_mismatch',
  'entity_type_rejected',
  'operation_unsupported',
  'ticket_project_required',
  'ticket_title_invalid',
  'ticket_description_invalid',
  'ticket_status_invalid',
  'ticket_priority_invalid',
  'ticket_task_type_invalid',
  'ticket_chat_invalid',
  'ticket_assignee_invalid',
  'ticket_archived_invalid',
  'parent_ticket_invalid',
  'ticket_key_conflict',
  'project_name_invalid',
  'project_key_invalid',
  'project_status_invalid',
  'project_status_required',
  'project_key_conflict',
  'message_role_invalid',
  'message_payload_invalid',
  'message_metadata_invalid',
  'message_content_invalid',
  'message_chat_required',
  'usage_tokens_out_of_range',
  'usage_model_required',
  'usage_route_invalid',
  'usage_event_id_mismatch',
  'usage_immutable',
  'usage_server_observed',
]);

/** Whether a receipt's `detail` names a refusal no resend can fix. */
export function isPermanentRefusal(detail: string | undefined): boolean {
  return detail !== undefined && PERMANENT_REFUSALS.has(detail);
}
