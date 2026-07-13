import NotFoundContent from './NotFoundContent';

// Branded 404. Renders under the now-static root layout, so it prerenders as
// static (no Edge Runtime / dynamic function needed). Localization happens
// client-side in NotFoundContent via the LocaleProvider.
export default function NotFound() {
  return <NotFoundContent />;
}
