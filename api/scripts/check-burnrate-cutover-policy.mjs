#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const BURNRATE_POLICY_PATH = resolve(here, '..', 'src', 'application', 'migration', 'burnrateCutoverPolicy.json');
export const REQUIRED_CAPABILITIES = ['affiliates', 'phoneVoip', 'blogContent', 'webPush', 'pricing', 'providers'];
export const REQUIRED_PROVIDERS = ['stripe', 'helcim', 'plaid', 'signalwire', 'recall', 'tavily', 'email', 'slack', 'google', 'microsoft', 'github', 'linkedin'];

export function readBurnrateCutoverPolicy() {
  return JSON.parse(readFileSync(BURNRATE_POLICY_PATH, 'utf8'));
}

export function validateBurnrateCutoverPolicy(policy) {
  const errors = [];
  if (policy?.newTablesAllowed !== false) errors.push('newTablesAllowed must be false');
  for (const key of REQUIRED_CAPABILITIES) {
    const decision = policy?.capabilities?.[key];
    if (!decision) errors.push(`missing capability decision: ${key}`);
    else for (const field of ['decision', 'owner', 'destination', 'reason']) if (!String(decision[field] ?? '').trim()) errors.push(`${key}.${field} is required`);
  }
  for (const key of REQUIRED_PROVIDERS) {
    const decision = policy?.providers?.[key];
    if (!decision) errors.push(`missing provider decision: ${key}`);
    else for (const field of ['decision', 'owner', 'credentialAction', 'dataAction']) if (!String(decision[field] ?? '').trim()) errors.push(`${key}.${field} is required`);
  }
  const undecided = [
    ...Object.entries(policy?.capabilities ?? {}), ...Object.entries(policy?.providers ?? {}),
  ].filter(([, value]) => /pending|pick|tbd|undecided/i.test(String(value?.decision ?? '')));
  if (undecided.length) errors.push(`undecided entries: ${undecided.map(([key]) => key).join(', ')}`);
  if (!/knowledge_documents/.test(policy?.capabilities?.blogContent?.destination ?? '')) errors.push('blogContent must land in the existing knowledge owner');
  if (!/^retire/.test(policy?.capabilities?.webPush?.decision ?? '')) errors.push('webPush must remain retired');
  if (!/^retire/.test(policy?.capabilities?.phoneVoip?.decision ?? '')) errors.push('phoneVoip must not introduce a second carrier product');
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const policy = readBurnrateCutoverPolicy();
  const errors = validateBurnrateCutoverPolicy(policy);
  if (errors.length) {
    console.error(`❌ BurnRateOS cutover policy invalid:\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`✅ BurnRateOS cutover policy v${policy.version} settled — ${REQUIRED_CAPABILITIES.length} capability and ${REQUIRED_PROVIDERS.length} provider decisions; new tables forbidden.`);
}
