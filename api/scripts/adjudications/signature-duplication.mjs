/**
 * DUPLICATE-SHAPE VERDICTS — table pairs whose payload columns overlap above the
 * guard's threshold and are, on inspection, two different facts.
 *
 * `check-signature-duplication.mjs` compares columns, so it is measuring SHAPE
 * and is blind to meaning. Two tables can be (provider, encrypted_secret,
 * created_at) and be the same fact recorded twice, or be two children of two
 * different aggregates that happen to configure the same kind of thing. Only
 * reading them answers that.
 *
 * These arguments used to live as `#` comments in the baseline file, where the
 * next `--update` would have deleted them without any diff a reviewer would read
 * as a deletion. They are data now; see `scripts/lib/adjudications.mjs`.
 *
 * The test: can ONE table hold both populations without a column that carries an
 * invariant becoming nullable, or a foreign key becoming a discriminator string?
 * A cluster that fails the test is duplication and stays in the baseline as work.
 */
export default {
  'error_collector_integrations = feedback_collector_integrations':
    'the two rows are children of DIFFERENT aggregates: one hangs off `error_collectors`, ' +
      'the other off `feedback_collectors`, and each cascades with its own parent. Folding ' +
      'them into one table means `collector_id` must point at two parents, which is either ' +
      'a polymorphic FK (forbidden by check-polymorphic-fk) or a pair of nullable FKs ' +
      'guarded by a CHECK — trading an enforced parent relationship for one the database ' +
      'can no longer enforce. The shape overlap is real but shallow: `provider` plus an ' +
      'encrypted secret is what ANY signed-webhook configuration looks like. The behaviour ' +
      'that matters is NOT duplicated — verification and normalisation live in one adapter ' +
      'registry per pillar and share `infrastructure/crypto/webhookHmac`.',

  'extension_categories = stage_lookup':
    'both are global vocabularies, so both are (key, label, description, position) — which ' +
      'is the SHAPE every lookup table has, and all the overlap is measuring. Neither can ' +
      'hold the other. `stage_lookup` is the platform-wide company-stage vocabulary a tenant ' +
      'selects FROM, the shared axis that makes two tenants’ Series A the same thing; its ' +
      '`category` column subdivides KINDS OF STAGE and is not a free slot for unrelated ' +
      'vocabularies. They differ where it counts — in IDENTITY. `extension_categories.key` ' +
      'is the PRIMARY KEY, so a category is referenceable by name; `stage_lookup` is a serial ' +
      'id unique on (category, key), so its rows are identified only inside a namespace. ' +
      '`extension_categories.active` also lets a chip be RETIRED without deleting a row, a ' +
      'lifecycle `stage_lookup` has no column for. The real consolidation, if one is ever ' +
      'wanted, is a properly named shared-vocabulary primitive both become rows of — not ' +
      'moving one into a table named after the other.',
};
