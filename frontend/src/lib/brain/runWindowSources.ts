import { gatewayModelWindows, type RunWindowSources } from '@seanhogg/builderforce-brain-embedded';
import { browserPageEngines } from './localFirst';

/**
 * Where the web Brain's run learns the window of the model a request is about to ask
 * for (brain-embedded's window fit): the gateway catalog's windows from the cached
 * `/llm/v1/models` surface, and this page's engines as the live local runtimes — read
 * only when the target is an on-device model, so a cloud run never builds the engines.
 * Without it a stall failover onto a smaller cloud model sent the whole transcript.
 */
export function browserRunWindowSources(surface: Parameters<typeof gatewayModelWindows>[0]): RunWindowSources {
  return {
    cloud: gatewayModelWindows(surface),
    probes: () => browserPageEngines().probe(),
  };
}
