import type { Metadata } from 'next';
import SalesCanvasLauncher from '../SalesCanvasLauncher';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Opening your sales canvas',
  description: 'Provisions the associate workspace and opens the prescriptive sales canvas.',
};

/**
 * The LANDING for a sales associate — provisions a workspace if they have none,
 * seeds the prescriptive canvas if it has never been built, and opens it.
 *
 * It moved off `/sales` because `/sales` is the hub: a route that redirects can
 * never also be a destination, and while the launcher lived there the "Sales Hub"
 * menu item had nothing behind it.
 */
export default function SalesCanvasPage() {
  return <SalesCanvasLauncher />;
}
