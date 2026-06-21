/**
 * Explorer engine — drive a single authenticated browser page through a
 * heat-derived plan and capture every runtime error along the way.
 *
 * This is the "perform testing actions + capture errors" core of the Agentic
 * Tester. It does NOT use `playwright test`; it drives the page directly (like
 * persona-login) so it can run as a plain script in a container. Errors come
 * from four live sources wired as listeners — console errors, uncaught page
 * exceptions, failed/5xx network requests — plus assertion failures when a
 * planned interaction can't be performed or the page stops being healthy.
 *
 * Each finding inherits the interaction *heat* of the zone the step targeted, so
 * a break on a heavily-used control is ranked above one nobody touches.
 */

import type { ConsoleMessage, Page, Request, Response } from '@playwright/test';
import type { ExploreFinding, ExploreFindingType, ExplorePlanStep } from './bf';

/** Error-boundary / crash text that means the route rendered broken. */
const ERROR_BOUNDARY_RE = /something went wrong|application error|unhandled runtime error|this page isn'?t working|500 internal/i;

const MAX_FINDINGS = 200;
const STEP_TIMEOUT = 8_000;

export interface ExploreResult {
  findings: ExploreFinding[];
  zonesExplored: number;
}

/** Mutable attribution context the async listeners read when an error fires. */
interface Ctx {
  route: string;
  heat: number;
}

export async function explore(page: Page, plan: ExplorePlanStep[]): Promise<ExploreResult> {
  const findings: ExploreFinding[] = [];
  const seen = new Set<string>();
  const ctx: Ctx = { route: '/', heat: 0 };

  const push = (f: ExploreFinding): void => {
    if (findings.length >= MAX_FINDINGS) return;
    const key = `${f.type}|${f.route ?? ''}|${f.message.slice(0, 160)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  // ── Live error sources ──────────────────────────────────────────────────────
  const onConsole = (msg: ConsoleMessage): void => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Browser noise that isn't an app fault — favicon 404s, ad-blocked beacons.
    if (/favicon|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text) && !/uncaught|typeerror|referenceerror/i.test(text)) return;
    push({ type: 'console', route: ctx.route, heat: ctx.heat, message: text.slice(0, 1000) });
  };
  const onPageError = (err: Error): void => {
    push({ type: 'pageerror', route: ctx.route, heat: ctx.heat, message: err.message.slice(0, 1000), detail: err.stack?.slice(0, 8000) ?? null });
  };
  const onRequestFailed = (req: Request): void => {
    const failure = req.failure()?.errorText ?? 'request failed';
    if (/ERR_ABORTED/i.test(failure)) return; // navigations supersede in-flight requests
    push({ type: 'network', route: ctx.route, heat: ctx.heat, message: `${req.method()} ${req.url().slice(0, 300)} — ${failure}`, detail: req.url().slice(0, 2000) });
  };
  const onResponse = (res: Response): void => {
    if (res.status() < 500) return;
    push({ type: 'network', route: ctx.route, heat: ctx.heat, message: `${res.status()} ${res.request().method()} ${res.url().slice(0, 300)}`, detail: res.url().slice(0, 2000) });
  };
  const onCrash = (): void => {
    push({ type: 'crash', route: ctx.route, heat: ctx.heat, severity: 'critical', message: `page crashed at ${ctx.route}` });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  page.on('crash', onCrash);

  let zonesExplored = 0;
  try {
    for (const step of plan) {
      ctx.heat = step.heat ?? 0;
      try {
        switch (step.action) {
          case 'goto':
            if (step.route) {
              ctx.route = step.route;
              const resp = await page.goto(step.route, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
              zonesExplored++;
              if (resp && resp.status() >= 400) {
                push({ type: 'navigation', route: step.route, heat: ctx.heat, severity: resp.status() >= 500 ? 'critical' : 'high', message: `navigation to ${step.route} returned HTTP ${resp.status()}` });
              }
              await checkHealth(page, step.route, ctx.heat, push);
            }
            break;

          case 'click':
            if (step.selector) {
              zonesExplored++;
              try {
                await page.locator(step.selector).first().click({ timeout: STEP_TIMEOUT });
                await checkHealth(page, ctx.route, ctx.heat, push);
              } catch (err) {
                push({ type: 'assertion', route: ctx.route, selector: step.selector, heat: ctx.heat, message: `could not click ${step.label ?? step.selector}: ${errMsg(err)}` });
              }
            }
            break;

          case 'fill':
            if (step.selector) {
              zonesExplored++;
              try {
                await page.locator(step.selector).first().fill(step.value ?? 'qa-probe', { timeout: STEP_TIMEOUT });
              } catch (err) {
                push({ type: 'assertion', route: ctx.route, selector: step.selector, heat: ctx.heat, message: `could not fill ${step.label ?? step.selector}: ${errMsg(err)}` });
              }
            }
            break;

          case 'expect':
            await checkHealth(page, ctx.route, ctx.heat, push);
            break;

          case 'waitFor':
            if (step.selector) await page.locator(step.selector).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT }).catch(() => {});
            break;

          case 'press':
            if (step.value) await page.keyboard.press(step.value).catch(() => {});
            break;
        }
      } catch (err) {
        // A step blowing up is itself a finding, not a run-ender — keep exploring.
        push({ type: 'assertion', route: ctx.route, selector: step.selector ?? null, heat: ctx.heat, message: `step '${step.action}' failed: ${errMsg(err)}` });
      }
      // Let async listeners (console/network) flush before the next step.
      await page.waitForTimeout(50).catch(() => {});
    }
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    page.off('crash', onCrash);
  }

  return { findings, zonesExplored };
}

/** After navigation/interaction, assert the page is still healthy: not bounced to
 *  /login (a broken auth/redirect) and no error-boundary text on screen. */
async function checkHealth(page: Page, route: string, heat: number, push: (f: ExploreFinding) => void): Promise<void> {
  if (/\/login(\b|\/|\?|$)/.test(page.url())) {
    push({ type: 'navigation', route, heat, severity: 'high', message: `redirected to /login while exploring ${route} (session/auth or guard failure)` });
    return;
  }
  try {
    const boundary = await page.getByText(ERROR_BOUNDARY_RE).count();
    if (boundary > 0) {
      push({ type: 'pageerror', route, heat, severity: 'critical', message: `error boundary visible on ${route}` });
    }
  } catch {
    /* getByText can throw mid-navigation — ignore, the next step re-checks. */
  }
}

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 400);
}

/** Roll the captured findings into a run status: any high/critical finding fails
 *  the exploration; otherwise it passes (low/medium are advisory). */
export function outcomeStatus(findings: ExploreFinding[]): 'passed' | 'failed' {
  const blocking = findings.some((f) => f.severity === 'high' || f.severity === 'critical' || ['pageerror', 'crash', 'navigation'].includes(f.type));
  return blocking ? 'failed' : 'passed';
}

export function summarize(findings: ExploreFinding[]): string {
  if (findings.length === 0) return 'No runtime errors captured across the explored hot zones.';
  const byType = new Map<ExploreFindingType, number>();
  for (const f of findings) byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
  const parts = [...byType.entries()].map(([t, n]) => `${n} ${t}`);
  return `Captured ${findings.length} finding(s): ${parts.join(', ')}.`;
}
