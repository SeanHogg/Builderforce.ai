/**
 * The P1a spike's opt-in (PRD 43 Phases): OFF unless a developer turns it on, on any host — the web app
 * (`?kgStage=spike` or the storage key) and the VS Code webview (devtools console:
 * `localStorage.setItem('kg.stage', 'spike')`, then reopen the view). Every read is guarded: a blocked store is "off".
 */

export const STAGE_SPIKE_KEY = 'kg.stage';
export const STAGE_SPIKE_VALUE = 'spike';

export function stageSpikeOn(): boolean {
    try {
        const search = typeof location === 'undefined' ? '' : location.search;
        if (new URLSearchParams(search).get('kgStage') === STAGE_SPIKE_VALUE) return true;
        return typeof localStorage !== 'undefined' && localStorage.getItem(STAGE_SPIKE_KEY) === STAGE_SPIKE_VALUE;
    } catch {
        return false;
    }
}
