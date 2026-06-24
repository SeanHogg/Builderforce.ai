import NotFoundContent from './NotFoundContent';

// Next's generated /_not-found route does NOT inherit the root layout's
// `runtime = 'edge'`, so @cloudflare/next-on-pages rejects it ("not configured
// to run with the Edge Runtime"). A custom not-found that declares edge fixes
// it. Kept as a server component with no runtime logic (just renders a client
// child) so the adapter's "not-found may contain runtime logic" caveat doesn't
// apply; localization happens client-side in NotFoundContent.
export const runtime = 'edge';

export default function NotFound() {
  return <NotFoundContent />;
}
