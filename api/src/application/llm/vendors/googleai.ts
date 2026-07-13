/**
 * Google AI (Gemini) vendor module — direct call to Google's Generative Language
 * API via its OpenAI-compatible surface at
 * `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
 *
 * Used as the primary premium fallback for the gateway's cascade: after the
 * 2-attempt free budget is exhausted, the chain falls through here so callers
 * always see a successful response from a high-reliability paid endpoint.
 *
 * All catalog entries are classified PREMIUM — even `gemini-2.5-flash-lite`,
 * the cheapest model, is paid and reserved for fallback rather than primary
 * Free-pool rotation. Authenticates with `GOOGLE_API_KEY`.
 */

import { createOpenAICompatibleVendor } from './openaiCompatible';
import type { VendorModelEntry, VendorModule } from './types';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// All Gemini 2.5 models are natively multimodal (image input), support function
// calling, and emit structured output — declare it so the shape-router
// (`reorderPoolByShape`/`capabilitiesForModel`) recognises them. Without this an
// image request treated them as NON-vision and demoted them below the small
// declared vision models, which returned an empty turn → the user's "No response"
// on a pasted image. (The Gemini strict-`json_schema` ceiling is handled
// separately by `isLowSchemaCeilingModel`, not by withholding `structured_output`.)
const GEMINI_CAPS: VendorModelEntry['capabilities'] = ['tools', 'structured_output', 'vision'];

const CATALOG: ReadonlyArray<VendorModelEntry> = [
  { id: 'gemini-2.5-flash',      tier: 'PREMIUM', label: 'Gemini 2.5 Flash (Google AI)',      brand: 'Google', capabilities: GEMINI_CAPS },
  { id: 'gemini-2.5-flash-lite', tier: 'PREMIUM', label: 'Gemini 2.5 Flash Lite (Google AI)', brand: 'Google', capabilities: GEMINI_CAPS },
  { id: 'gemini-2.5-pro',        tier: 'PREMIUM', label: 'Gemini 2.5 Pro (Google AI)',        brand: 'Google', capabilities: GEMINI_CAPS },
];

// Google AI is a plain OpenAI-compatible endpoint (Bearer key, standard chat body
// + response), so it's built from the shared factory like nvidia/cerebras. Unlike
// the commercial factory vendors it stays `autoRoute: true` (it's the premium
// fallback at the tail of every cascade) and defaults non-catalog ids to PREMIUM
// (all Gemini here is paid). tierFor/apiKeyFrom/call/callStream are the factory's.
export const googleAiModule: VendorModule = createOpenAICompatibleVendor({
  id: 'googleai',
  baseUrl: ENDPOINT,
  apiKeyEnv: 'GOOGLE_API_KEY',
  catalog: CATALOG,
  defaultTier: 'PREMIUM',
  autoRoute: true,
});
