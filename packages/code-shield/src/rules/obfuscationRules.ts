import type { Rule } from './rule.js';

const OBFUSCATED_IDENTIFIER = /\b_0x[0-9a-f]{4,}\b/g;
const OBFUSCATED_IDENTIFIER_THRESHOLD = 20;

/** Concealed code and encoded payloads. Encoding alone is legitimate, so weights are low. */
export const OBFUSCATION_RULES: readonly Rule[] = [
  {
    id: 'obfuscated-code', category: 'obfuscation', severity: 'MEDIUM', weight: 10, attack: 'T1027', scope: 'source',
    title: 'Hex-encoded string sequence detected (possible obfuscation)',
    pattern: /(\\x[0-9a-fA-F]{2}){6,}/,
    remediation: 'Review the decoded value; ship readable source.',
  },
  {
    id: 'obfuscated-code', category: 'obfuscation', severity: 'MEDIUM', weight: 15, attack: 'T1027', scope: 'source',
    title: 'Large base64 payload with decode call detected (possible obfuscation)',
    pattern: /(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/,
    remediation: 'Review the decoded payload; ship readable source.',
  },
  {
    id: 'obfuscation.eval-decode', category: 'obfuscation', severity: 'HIGH', weight: 25, attack: 'T1027.010', scope: 'line',
    title: 'Decodes a payload and executes it (eval / Function of atob / Buffer.from)',
    pattern: /\b(?:eval|Function)\s*\(\s*(?:atob|Buffer\.from)\s*\(/,
    remediation: 'Never execute decoded payloads.',
  },
  {
    id: 'obfuscation.charcode-chain', category: 'obfuscation', severity: 'MEDIUM', weight: 15, attack: 'T1027', scope: 'line',
    title: 'Long String.fromCharCode chain (string built to hide its content)',
    pattern: /String\.fromCharCode\s*\((?:\s*\d+\s*,){11,}\s*\d+\s*\)/,
    remediation: 'Write the string literally.',
  },
  {
    id: 'obfuscation.hex-identifiers', category: 'obfuscation', severity: 'MEDIUM', weight: 15, attack: 'T1027', scope: 'source',
    title: 'Machine-mangled identifiers (_0x…) typical of obfuscator output',
    pattern: /\b_0x[0-9a-f]{4,}\b/,
    accept: (_m, text) => (text.match(OBFUSCATED_IDENTIFIER)?.length ?? 0) >= OBFUSCATED_IDENTIFIER_THRESHOLD,
    remediation: 'Ship readable source.',
  },
];
