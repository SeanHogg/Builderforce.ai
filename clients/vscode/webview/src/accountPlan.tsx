import type { UpgradeTarget } from '@seanhogg/builderforce-brain-ui';
import { post } from './vscodeBridge';

/**
 * The ONE place the VSIX decides where an "upgrade" click lands — the `/` menu's
 * Status tab (the shared `WorkStatusPanel`) and the chat's error banner both call it,
 * so they can never send the user somewhere different for the same problem.
 *
 * `/pricing` IS the billing console in the web app — it renders the Current Plan card,
 * subscription state and the upgrade forms — so both destinations live there,
 * distinguished by the deep-link param the page already understands (`?upgrade=pro`
 * pre-opens the upgrade form, the same link the web app's own PremiumModelUnlock uses).
 *
 * There is deliberately no `/settings?tab=billing`: that route does not exist, and
 * sending someone to a page that can't fix their problem is worse than the error
 * message that at least named it.
 */
const UPGRADE_PATHS: Record<UpgradeTarget, string> = {
  pricing: '/pricing?upgrade=pro',
  billing: '/pricing',
};

/**
 * Open the web app at the page that actually fixes the block. The host owns the
 * browser (and the web base URL), so this goes over the bridge — see the `open.web`
 * case in `builderforcePanel.ts`.
 */
export function openUpgrade(target: UpgradeTarget): void {
  post('open.web', { path: UPGRADE_PATHS[target] });
}
