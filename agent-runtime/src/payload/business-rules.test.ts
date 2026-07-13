/** Business Ruleset Unit Tests
 *
 * This module provides lightweight sanity checks for the registered
 * business rules catalog (business-rules.json) as defined in FR‑3.
 * These tests ensure the ruleset structure complies with the expected
 * schema and catalog invariants (AC‑5/AC‑8).
 *
 * NOTE on strict resolver support:
 * PRD/ACs do not require resolver-specific surface exports.
 * The catalog loading/validation functions are first-class:
 *   - getBusinessRulesets/from-catalog
 *   - resolveBusinessRuleset/by-name
 *   - buildDerivedFunctionMap
 *   - derive/unification
 *   - registerBusinessRuleset
 * Any resolver per-role/field is not a needed surface for AC/FR.
 */