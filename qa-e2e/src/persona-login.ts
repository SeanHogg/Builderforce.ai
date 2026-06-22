/**
 * Persona login — drive a customer site's login form with a persona's real
 * credentials and capture the resulting authenticated storageState.
 *
 * Arbitrary external sites have no token API we can inject, so the only general
 * way to authenticate is to type the username/password into the login form like
 * a user would. Selectors come from the credential's optional `loginSelectors`;
 * otherwise we fall back to broad heuristics that cover the common cases.
 */

import { chromium } from '@playwright/test';
import type { CredentialSecret } from './bf';

const USERNAME_HEURISTIC =
  'input[type="email"], input[name*="email" i], input[name*="user" i], input[autocomplete="username"], #username, #email';
const PASSWORD_HEURISTIC = 'input[type="password"], input[name*="pass" i], #password';
const SUBMIT_HEURISTIC =
  'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")';

/**
 * Logs in as one persona and returns the storageState (cookies + localStorage)
 * for re-use by the test specs / the explorer's browser context. Throws if the
 * login clearly failed (still on the login URL with the password field present
 * after submit). The return type is Playwright's own storageState shape so it
 * drops straight into `browser.newContext({ storageState })`.
 */
export async function loginPersona(baseUrl: string, secret: CredentialSecret) {
  const loginPath = secret.loginUrl ?? '/login';
  const loginUrl = new URL(loginPath, baseUrl).toString();
  const sel = secret.loginSelectors ?? {};

  const usernameSel = sel.usernameSelector ?? USERNAME_HEURISTIC;
  const passwordSel = sel.passwordSelector ?? PASSWORD_HEURISTIC;
  const submitSel = sel.submitSelector ?? SUBMIT_HEURISTIC;

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    await page.locator(usernameSel).first().fill(secret.username);

    // Two-step (identifier-first) flows: the password field isn't on the page
    // until the username is submitted. If we can't see a password field yet,
    // click continue/next/submit and wait for it to appear before typing the
    // password. Single-step forms fall straight through.
    const passwordVisible = await page
      .locator(passwordSel)
      .first()
      .isVisible()
      .catch(() => false);
    if (!passwordVisible) {
      await page.locator(submitSel).first().click().catch(() => {});
      await page
        .locator(passwordSel)
        .first()
        .waitFor({ state: 'visible', timeout: 5_000 })
        .catch(() => {});
    }

    await page.locator(passwordSel).first().fill(secret.password);
    await page.locator(submitSel).first().click();

    // Give the app a moment to establish the session (redirect / token write).
    await page.waitForLoadState('networkidle').catch(() => {});

    const stillOnLogin =
      page.url().includes(loginPath) &&
      (await page.locator(passwordSel).count()) > 0;
    if (stillOnLogin) {
      throw new Error(`login appears to have failed for ${secret.username} (still on ${loginPath})`);
    }

    return await context.storageState();
  } finally {
    await browser.close();
  }
}
