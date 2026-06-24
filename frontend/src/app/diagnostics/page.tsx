import { redirect } from 'next/navigation';

export const runtime = 'edge';

/**
 * The Maturity Diagnostic moved onto the generic Diagnostics & Tools engine.
 * Preserve the old URL by redirecting to its canonical tool page.
 */
export default function DiagnosticsRedirect() {
  redirect('/tools/agentic-maturity');
}
