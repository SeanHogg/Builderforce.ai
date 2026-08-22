/**
 * Twilio platform coverage — the claim, as a test.
 *
 * Twilio's own platform list names nine surfaces: Voice, Email, Messaging, SMS,
 * WhatsApp, Conversations, Customer Data, Authentication and Conversational AI.
 * "Builderforce can build on any Twilio product" is a claim about all nine, and a
 * claim nobody checks decays the first time a manifest is refactored.
 *
 * So each surface is asserted through the ACTION a system would actually call,
 * not through the connector merely existing — a manifest with the right key and a
 * renamed action is exactly the regression this is here to catch.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_CONNECTORS } from './defaults';
import { actionCarriesRequestBody, authFieldsFor } from './connectorManifest';

/** Twilio surface → the connector + action that delivers it. */
const COVERAGE: Array<{ surface: string; connector: string; action: string }> = [
  { surface: 'SMS',               connector: 'twilio',                action: 'send_sms' },
  { surface: 'Messaging (MMS)',   connector: 'twilio',                action: 'send_mms' },
  { surface: 'WhatsApp',          connector: 'twilio',                action: 'send_whatsapp' },
  { surface: 'Voice',             connector: 'twilio',                action: 'make_call' },
  { surface: 'Email',             connector: 'sendgrid',              action: 'send_html_email' },
  { surface: 'Authentication',    connector: 'twilio-verify',         action: 'start_verification' },
  { surface: 'Conversations',     connector: 'twilio-conversations',  action: 'send_conversation_message' },
  { surface: 'Customer Data',     connector: 'twilio-segment',        action: 'track' },
  { surface: 'Conversational AI', connector: 'twilio-assistants',     action: 'send_assistant_message' },
];

describe('Twilio platform coverage', () => {
  for (const { surface, connector, action } of COVERAGE) {
    it(`covers ${surface} via ${connector}.${action}`, () => {
      const manifest = BUILTIN_CONNECTORS.get(connector);
      expect(manifest, `${connector} is not in the built-in catalog`).toBeTruthy();
      expect(
        manifest!.actions.some((a) => a.key === action),
        `${connector} has no action "${action}" — coverage of ${surface} is claimed but not delivered`,
      ).toBe(true);
    });
  }

  it('gives every Twilio connector a credential a person can actually obtain', () => {
    // A required auth field with no label is a connect form nobody can fill in,
    // which makes the connector unreachable however correct its actions are.
    for (const key of ['twilio', 'twilio-verify', 'twilio-lookup', 'twilio-conversations', 'twilio-segment', 'twilio-assistants']) {
      const manifest = BUILTIN_CONNECTORS.get(key);
      expect(manifest, key).toBeTruthy();
      const fields = authFieldsFor(manifest!);
      expect(fields.length, `${key} declares no auth fields`).toBeGreaterThan(0);
      for (const field of fields) expect(field.label, `${key}.${field.key} has no label`).toBeTruthy();
    }
  });

  it('keeps Conversations addressing on the wire names Twilio requires', () => {
    // `MessagingBinding.Address` / `.ProxyAddress` — the dot is part of the wire
    // name. Renaming these to something tidier makes adding an SMS participant
    // fail with an error that reads like a permissions problem.
    const manifest = BUILTIN_CONNECTORS.get('twilio-conversations')!;
    const addParticipant = manifest.actions.find((a) => a.key === 'add_participant')!;
    const wireNames = Object.values(addParticipant.params ?? {}).map((p) => p.name).filter(Boolean);
    expect(wireNames).toContain('MessagingBinding.Address');
    expect(wireNames).toContain('MessagingBinding.ProxyAddress');
  });

  it('sends Twilio REST bodies as form data, never JSON', () => {
    // Twilio's REST API rejects a JSON body outright. Every mutating action on the
    // account-level and Conversations manifests that SENDS a body must say so —
    // `actionCarriesRequestBody` is the runtime's own rule, not a second copy of
    // it, so a DELETE like `release_phone_number` is not asked to declare an
    // encoding for a body it never writes.
    for (const key of ['twilio', 'twilio-conversations']) {
      for (const action of BUILTIN_CONNECTORS.get(key)!.actions) {
        if (!action.mutates || !actionCarriesRequestBody(action)) continue;
        expect(action.bodyFormat, `${key}.${action.key} must post form-encoded`).toBe('form');
      }
    }
  });

  it('does not require a password for Segment, which authenticates with the write key alone', () => {
    // Segment's Tracking API uses HTTP Basic with the write key as the USERNAME
    // and an EMPTY password. A required password field makes people paste the
    // write key twice and get a 401 they cannot explain.
    const fields = authFieldsFor(BUILTIN_CONNECTORS.get('twilio-segment')!);
    const password = fields.find((f) => f.key === 'password');
    expect(password?.required ?? false).toBe(false);
  });
});
