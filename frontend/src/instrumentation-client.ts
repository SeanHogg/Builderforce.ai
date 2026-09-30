/**
 * Runs in the browser before any app code (Next.js client instrumentation).
 * Fills `crypto.randomUUID` on browsers that lack it (Safari < 15.4, insecure
 * contexts) so the app's direct calls never throw.
 */
import { installRandomUUID } from './lib/randomUUID';

installRandomUUID();
