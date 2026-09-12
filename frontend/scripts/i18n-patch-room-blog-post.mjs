// Catalog title/description for the new blog post, `blog.posts.<slug>.*` — the
// convention `src/lib/blogLocale.ts` reads. The English entry mirrors the post's
// front matter exactly (asserted by `blogLocale.test.ts`); the other four match
// the translated body already published beside it.
// Usage: node scripts/i18n-merge.mjs scripts/i18n-patch-room-blog-post.mjs

const SLUG = 'design-the-room-you-meet-in';

export const PATCHES = {
  en: { blog: { posts: { [SLUG]: {
    title: 'Design the room you meet in — then walk it',
    description: 'The room on your board used to be one room. Now it is a boardroom, an office kitchen or an open floor of desks — or a room you lay out piece by piece, walk through like a game, sell in the marketplace, and play your Roblox place inside.',
  } } } },
  zh: { blog: { posts: { [SLUG]: {
    title: '设计你开会的房间——然后在里面走动',
    description: '你看板上的房间以前只有一个。现在它可以是董事会会议室、办公室茶水间或开放式办公区——或者一个你逐件布置、像游戏一样走动、在市场中出售、并能在里面游玩 Roblox 场景的房间。',
  } } } },
  es: { blog: { posts: { [SLUG]: {
    title: 'Diseña la sala donde te reúnes — y recórrela',
    description: 'La sala de tu tablero solía ser una sola sala. Ahora es una sala de juntas, una cocina de oficina o una planta abierta de escritorios — o una sala que distribuyes pieza a pieza, recorres como en un juego, vendes en el marketplace y en la que juegas tu lugar de Roblox.',
  } } } },
  fr: { blog: { posts: { [SLUG]: {
    title: 'Aménagez la salle où vous vous réunissez — puis parcourez-la',
    description: 'La salle de votre board était autrefois une seule salle. Elle est désormais une salle du conseil, une cuisine de bureau ou un open space de bureaux — ou une salle que vous aménagez pièce par pièce, parcourez comme un jeu, vendez sur la marketplace, et où vous jouez à votre lieu Roblox.',
  } } } },
  de: { blog: { posts: { [SLUG]: {
    title: 'Gestalte den Raum, in dem du dich triffst — und geh hindurch',
    description: 'Der Raum auf deinem Board war früher ein einziger Raum. Jetzt ist er ein Konferenzraum, eine Büroküche oder ein Großraumbüro — oder ein Raum, den du Stück für Stück einrichtest, wie in einem Spiel begehst, im Marketplace verkaufst und in dem du deinen Roblox-Ort spielst.',
  } } } },
};
