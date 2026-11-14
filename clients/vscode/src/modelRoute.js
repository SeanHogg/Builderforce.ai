/**
 * The {@link ModelRoute} contract — where one turn runs, and with which model — and the
 * error an unauthorized route fails with. Pure data: resolving a route and choosing its
 * transport stay together in `modelRouting.ts` (the ONE router; `modelRouting.test.ts`
 * guards that no other module reaches for a transport).
 */
import { localRuntime, } from "@builderforce/local-inference";
/** The error a turn on an {@link ModelRoute.unauthorized} route fails with. */
export function unauthorizedError(unauthorized) {
    const label = localRuntime(unauthorized.provider).label;
    return new Error(`${label} could not be authorized on this machine, so this turn was not sent. ${unauthorized.detail} `
        + `Sign in again in ${label}, or connect it with "BuilderForce: Manage Model Provider Connections".`);
}
//# sourceMappingURL=modelRoute.js.map