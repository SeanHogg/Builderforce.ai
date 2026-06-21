/**
 * QaGeneratorService — turn a flow (or a raw route map) into a runnable
 * Playwright spec via the builderforceLLM gateway.
 *
 * The generated spec assumes the browser context is already authenticated:
 * the CI harness logs in once in global-setup and persists `storageState`, so
 * specs never script the login form (per the "authenticated smoke test" goal).
 * Specs use relative paths against `baseURL` from playwright.config.
 *
 * Robustness: if the LLM is unavailable or returns unusable output, we fall
 * back to a deterministic template generator so the pipeline always produces a
 * spec that at least navigates the flow and asserts each route renders.
 */

import { ideProxy } from '../llm/LlmProxyService';
import { recordProxyUsage } from '../llm/usageLedger';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { QaStep } from './qaTypes';

export interface GenerateInput {
  name: string;
  slug: string;
  description?: string | null;
  startRoute?: string | null;
  steps: QaStep[];
  /** The persona this scenario runs as — woven into the prompt so the model
   *  asserts role-appropriate expectations (e.g. an admin-only control is
   *  visible as admin, absent as viewer). The session itself is injected by the
   *  harness; the spec never logs in. */
  persona?: { label?: string; role?: string | null } | null;
}

export interface GenerateResult {
  spec: string;
  steps: QaStep[];
  model: string | null;
}

const SYSTEM_PROMPT = `You are a senior QA engineer writing Playwright smoke tests for a Next.js web app.

Hard requirements for the spec you output:
- TypeScript, importing { test, expect } from '@playwright/test'.
- ONE test() per flow, titled with the flow name.
- The browser context is ALREADY authenticated via a shared storageState — do NOT log in, do NOT touch /login.
- Use RELATIVE paths with page.goto() (baseURL is configured globally), e.g. page.goto('/dashboard').
- Prefer resilient locators in this order: getByTestId, getByRole({ name }), getByText. Avoid brittle nth-child CSS.
- After each navigation assert the page is healthy: the route did not redirect to /login and no error boundary text ("Something went wrong", "Application error") is visible. Assert a meaningful element is visible.
- Keep waits explicit (await expect(...).toBeVisible()), never arbitrary timeouts.
- No comments that leak secrets. No external network assertions.

Output ONLY a JSON object: {"spec": "<full .ts source>", "steps": [<normalized QaStep array you actually exercised>]}.
Do not wrap the JSON in markdown fences.`;

function extractContent(raw: unknown): string | null {
  const choices = (raw as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : null;
}

/** Strip ```...``` fences and pull the first balanced JSON object out of a string. */
function parseModelJson(content: string): { spec?: string; steps?: QaStep[] } | null {
  let s = content.trim();
  const fence = /^```(?:json|ts|typescript)?\s*([\s\S]*?)```$/m.exec(s);
  if (fence?.[1]) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Static validation of a model-authored spec before it is ever written to disk
 * and executed in CI [1067]. A poisoned/hallucinated spec (or a compromised QA
 * token) could otherwise run arbitrary code in the runner. We do NOT trust the
 * generator prompt alone — we reject any spec that:
 *   - imports anything other than '@playwright/test'
 *   - references Node/host capabilities (fs, child_process, process, require,
 *     dynamic import(), eval, Function constructor, fetch/XHR/WebSocket, env)
 *   - is implausibly large (a spec that drives a browser is small).
 * A rejected spec causes the generator to fall back to the deterministic
 * template, so the pipeline still produces a safe runnable test.
 *
 * This is an allowlist on *imports* plus a denylist on *escape hatches* — a
 * pragmatic AST-free guard that's cheap to run in a Worker. It does not attempt
 * to prove the spec only drives the browser, but it removes every known vector
 * for arbitrary code execution / data exfiltration from the CI runner.
 */
const FORBIDDEN_SPEC_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\brequire\s*\(/, reason: 'require()' },
  { re: /\bimport\s*\(/, reason: 'dynamic import()' },
  { re: /\beval\s*\(/, reason: 'eval()' },
  { re: /\bnew\s+Function\b/, reason: 'Function constructor' },
  { re: /\bprocess\b/, reason: 'process access' },
  { re: /\bchild_process\b/, reason: 'child_process' },
  { re: /\bnode:[a-z]/i, reason: 'node: builtin import' },
  { re: /\bfrom\s+['"]fs['"]/, reason: 'fs import' },
  { re: /\bglobalThis\b/, reason: 'globalThis' },
  { re: /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/, reason: 'raw network call' },
  { re: /\bpage\.request\b/, reason: 'page.request (raw HTTP)' },
  { re: /\brequest\.(get|post|put|delete|patch|fetch)\b/, reason: 'APIRequestContext (raw HTTP)' },
  { re: /\bpage\.evaluate\w*\s*\(/, reason: 'page.evaluate (arbitrary in-page JS)' },
  { re: /\baddInitScript\b/, reason: 'addInitScript (arbitrary in-page JS)' },
  { re: /\bexposeFunction\b/, reason: 'exposeFunction' },
];

/** Only these top-level imports are allowed in a generated spec. */
const SPEC_IMPORT_RE = /\bimport\b[\s\S]*?\bfrom\s+['"]([^'"]+)['"]/g;
const SPEC_MAX_LEN = 16_000;

export interface SpecValidation {
  ok: boolean;
  reason?: string;
}

export function validateSpec(spec: string): SpecValidation {
  if (typeof spec !== 'string' || spec.length === 0) return { ok: false, reason: 'empty' };
  if (spec.length > SPEC_MAX_LEN) return { ok: false, reason: `spec too large (${spec.length} > ${SPEC_MAX_LEN})` };
  if (!spec.includes('@playwright/test')) return { ok: false, reason: 'missing @playwright/test import' };

  // Allowlist imports: only '@playwright/test' may be imported.
  let m: RegExpExecArray | null;
  SPEC_IMPORT_RE.lastIndex = 0;
  while ((m = SPEC_IMPORT_RE.exec(spec)) !== null) {
    if (m[1] !== '@playwright/test') return { ok: false, reason: `disallowed import '${m[1]}'` };
  }

  for (const { re, reason } of FORBIDDEN_SPEC_PATTERNS) {
    if (re.test(spec)) return { ok: false, reason };
  }
  return { ok: true };
}

/** Deterministic template — always produces a valid, runnable smoke spec. */
export function fallbackSpec(input: GenerateInput): string {
  const title = input.name.replace(/'/g, "\\'");
  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`// Auto-generated smoke test (deterministic fallback) for: ${input.slug}`);
  lines.push(`test('${title}', async ({ page }) => {`);
  let emitted = false;
  for (const step of input.steps) {
    if (step.action === 'goto' && step.route) {
      const route = step.route.replace(/'/g, "\\'");
      lines.push(`  await page.goto('${route}');`);
      lines.push(`  await expect(page).not.toHaveURL(/\\/login/);`);
      lines.push(`  await expect(page.getByText(/something went wrong|application error/i)).toHaveCount(0);`);
      lines.push(`  await expect(page.locator('body')).toBeVisible();`);
      emitted = true;
    } else if (step.action === 'click' && step.selector) {
      lines.push(`  await page.locator(${JSON.stringify(step.selector)}).first().click().catch(() => {});`);
    }
  }
  if (!emitted) {
    const route = (input.startRoute ?? '/dashboard').replace(/'/g, "\\'");
    lines.push(`  await page.goto('${route}');`);
    lines.push(`  await expect(page.locator('body')).toBeVisible();`);
  }
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

export class QaGeneratorService {
  constructor(private readonly env: Env, private readonly tenantId?: number) {}

  async generate(input: GenerateInput): Promise<GenerateResult> {
    // No LLM key configured → deterministic spec, no model.
    if (!this.env.OPENROUTER_API_KEY?.trim()) {
      return { spec: fallbackSpec(input), steps: input.steps, model: null };
    }

    const personaLine = input.persona
      ? `Persona: this scenario runs as "${input.persona.label ?? input.persona.role ?? 'a standard user'}"` +
        (input.persona.role ? ` (role: ${input.persona.role})` : '') +
        `. The session is already authenticated as this persona — assert role-appropriate UI (controls this role should/shouldn't see) and do NOT log in.\n`
      : '';
    const userPrompt =
      `Flow name: ${input.name}\n` +
      `Start route: ${input.startRoute ?? '(unknown)'}\n` +
      personaLine +
      (input.description ? `Context: ${input.description}\n` : '') +
      `Captured steps (JSON):\n${JSON.stringify(input.steps, null, 2)}\n\n` +
      `Write the Playwright smoke test for this flow.`;

    try {
      const result = await ideProxy(this.env).complete({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        useCase: 'qa_test_generation',
      });

      // Record this background generation in the usage ledger [1310] (best-effort,
      // no-ops without a tenantId or usage). Was previously invisible to billing.
      if (this.tenantId != null) {
        void recordProxyUsage(buildDatabase(this.env), this.env, {
          tenantId: this.tenantId,
          useCase: 'qa_test_generation',
          result,
        });
      }

      if (result.response.status >= 400) {
        return { spec: fallbackSpec(input), steps: input.steps, model: result.resolvedModel ?? null };
      }
      const raw = await result.response.json().catch(() => null);
      const content = extractContent(raw);
      const parsed = content ? parseModelJson(content) : null;
      // Validate the model output against the import allowlist + escape-hatch
      // denylist before accepting it [1067]. Any failure → deterministic
      // fallback, so a poisoned/hallucinated spec never reaches the CI runner.
      const candidate = typeof parsed?.spec === 'string' ? parsed.spec : '';
      const validation = validateSpec(candidate);
      const spec = validation.ok ? candidate : fallbackSpec(input);
      // Only trust the model's steps if its spec was trusted.
      const steps = validation.ok && Array.isArray(parsed?.steps) && parsed.steps.length > 0
        ? parsed.steps
        : input.steps;
      return { spec, steps, model: result.resolvedModel ?? null };
    } catch {
      return { spec: fallbackSpec(input), steps: input.steps, model: null };
    }
  }
}
