import { redirect } from 'next/navigation';

// The talent marketplace was merged into /marketplace as its "Talent" category —
// this standalone route now just forwards there. Individual profiles still live at
// /talent/[id]. The talent JSON-LD moved to /marketplace (see marketplace/page.tsx).
export const runtime = 'edge';

export default function TalentPage() {
  redirect('/marketplace?category=talent');
}
