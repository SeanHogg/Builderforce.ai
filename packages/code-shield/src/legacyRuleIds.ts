/**
 * Rule ids that were renamed when every id was namespaced (`<family>.<name>`). The ONE alias map: a surface
 * that has already shown or stored the old id (the skill installer's audit findings and its persisted
 * reports) maps the canonical id back through {@link legacyRuleId} instead of keeping a second spelling in
 * the rule tables. The rule tables themselves carry only the canonical ids.
 */
export const LEGACY_RULE_IDS: Readonly<Record<string, string>> = {
  'behavior.dangerous-exec': 'dangerous-exec',
  'behavior.dynamic-code-execution': 'dynamic-code-execution',
  'behavior.crypto-mining': 'crypto-mining',
  'behavior.suspicious-network': 'suspicious-network',
  'behavior.potential-exfiltration': 'potential-exfiltration',
  'behavior.env-harvesting': 'env-harvesting',
  // The two hex / base64 rules both reported `obfuscated-code`.
  'obfuscation.hex-string-sequence': 'obfuscated-code',
  'obfuscation.base64-payload': 'obfuscated-code',
};

/** The id a surface that predates namespacing reported for this rule (the canonical id when it never changed). */
export function legacyRuleId(ruleId: string): string {
  return LEGACY_RULE_IDS[ruleId] ?? ruleId;
}
