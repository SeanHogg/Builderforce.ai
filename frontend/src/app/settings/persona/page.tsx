/**
 * The old home of the insight lens, kept as a redirect.
 *
 * PRD 21 §7 decision 1: "Persona" (this lens) and "Personality" (the user's
 * psychometric profile) sat one index row apart and read as the same word. The
 * operator renamed this one to **Viewpoint**, and the page moved with the name.
 * Every link ever shared — and the `psychometricPersona` feature-gate entry that
 * still keys on the old path — resolves here and lands on the real page.
 */
import { retiredRoute } from '@/lib/routing/retiredRoute';

export default retiredRoute('/settings/viewpoint');
