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

export interface StorageState {
  cookies: unknown[];
  origins: unknown[];
}

/**
 * Logs in as one persona and returns the storageState (cookies + localStorage)
 * for re-use by the test specs. Throws if the login clearly failed (still on the
 * login URL with the password field present after submit).
 */
export async function loginPersona(baseUrl: string, secret: CredentialSecret): Promise<StorageState> {
  const loginPath = secret.loginUrl ?? '/login';
  const loginUrl = new URL(loginPath, baseUrl).toString();
  const sel = secret.loginSelectors ?? {};

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    await page.locator(sel.usernameSelector ?? USERNAME_HEURISTIC).first().fill(secret.username);
    await page.locator(sel.passwordSelector ?? PASSWORD_HEURISTIC).first().fill(secret.password);
    await page.locator(sel.submitSelector ?? SUBMIT_HEURISTIC).first().click();

    // Give the app a moment to establish the session (redirect / token write).
    await page.waitForLoadState('networkidle').catch(() => {});

    const stillOnLogin =
      page.url().includes(loginPath) &&
      (await page.locator(PASSWORD_HEURISTIC).count()) > 0;
    if (stillOnLogin) {
      throw new Error(`login appears to have failed for ${secret.username} (still on ${loginPath})`);
    }

    return (await context.storageState()) as StorageState;
  } finally {
    await browser.close();
  }
}
