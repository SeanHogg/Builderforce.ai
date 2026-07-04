import { redirect } from 'next/navigation';

// The model catalog was merged into /marketplace as its "Models" category — this
// standalone route now just forwards there. In-app nav links point straight at
// /marketplace?category=models; this redirect covers old bookmarks/SEO.
export const runtime = 'edge';

export default function ModelsPage() {
  redirect('/marketplace?category=models');
}
