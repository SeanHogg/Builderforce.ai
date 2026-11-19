/**
 * The domain layer's failure ports, routed to the caught-error reporter. The domain never
 * imports the application layer, so a domain module that must report a handled failure
 * exposes a sink, and each Worker's composition root (index.ts, gatewayWorker.ts) calls
 * this once, after `configureCaughtErrorReporter`.
 */
import { configureCookieDecodeFailureSink } from '../../domain/shared/hostCookie';
import { reportCaughtError } from './caughtErrorReporter';

export function configureDomainFailureSinks(): void {
  configureCookieDecodeFailureSink((error, cookieName) => reportCaughtError(error, {
    source: 'domain/shared/hostCookie.ts',
    operation: 'readCookieValues',
    level: 'warning',
    context: { cookieName },
  }));
}
