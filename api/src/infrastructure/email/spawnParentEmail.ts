/**
 * The Spawn trial's emails to the player's grown-up — four, at most once each:
 * the day the trial starts, halfway, the last day, and the day it ends
 * (`application/spawn/spawnTrial.ts` decides which is due). Each one says what
 * Spawn is, what it costs, and carries the parent link that lets the grown-up pay
 * without the player's password.
 *
 * Its own module with its own copy table rather than more lines in
 * `EmailService.ts` / `emailMessages.ts`: it composes the shared chrome
 * (`deliver`, `p`, `cta`, `MUTED`) and the table is typed over every locale, so a
 * missing translation is a compile error exactly as it is there.
 *
 * `{{Player}}` is a name the player typed, so it is left as a placeholder for
 * `deliver`'s escaping render — never interpolated here.
 */
import { cta, deliver, MUTED, p, type EmailEnv } from './EmailService';
import { emailCopy, fillCopy } from './emailMessages';
import { DEFAULT_EMAIL_LOCALE, type EmailLocale } from './emailLocale';

export type SpawnParentNotice = 'start' | 'midway' | 'lastDay' | 'ended';

interface NoticeCopy {
  subject: string;
  lead: string;
  cta: string;
}

interface SpawnParentCopy {
  greeting: string;
  notices: Record<SpawnParentNotice, NoticeCopy>;
  whatItIs: string;
  price: string;
  why: string;
}

const COPY: Record<EmailLocale, SpawnParentCopy> = {
  en: {
    greeting: 'Hi,',
    notices: {
      start: {
        subject: '{{Player}} started a free Spawn trial',
        lead: '<strong>{{Player}}</strong> just started a {{TrialDays}}-day free trial of Spawn and named you as their grown-up. The trial includes {{Tokens}} tokens (about {{Builds}} builds) and ends on <strong>{{EndDate}}</strong>.',
        cta: 'See Spawn',
      },
      midway: {
        subject: '{{Player}} is halfway through their Spawn trial',
        lead: '<strong>{{Player}}</strong> has been building Roblox games with Spawn. Their free trial has {{DaysLeft}} days left and ends on <strong>{{EndDate}}</strong>.',
        cta: 'Keep Spawn going',
      },
      lastDay: {
        subject: '{{Player}}’s Spawn trial ends tomorrow',
        lead: '<strong>{{Player}}</strong>’s free Spawn trial ends on <strong>{{EndDate}}</strong>. After that, the builder closes until the membership starts.',
        cta: 'Keep Spawn going',
      },
      ended: {
        subject: '{{Player}}’s Spawn trial has ended',
        lead: '<strong>{{Player}}</strong>’s free Spawn trial is over. Everything they made is still in Roblox Studio; nothing is deleted. A membership opens the builder again.',
        cta: 'Join Spawn',
      },
    },
    whatItIs: 'Spawn is an AI game builder for Roblox creators 13 and up. They describe a game and Spawn builds it in Roblox Studio as real parts and scripts they can read and learn from. It follows the Roblox Community Standards and refuses backdoor or hidden code.',
    price: 'The membership is <strong>{{Price}} a month</strong>, cancel any time. Tokens come in packs from $10, you choose every top-up, and builds that fail are never charged.',
    why: 'You got this because {{Player}} entered your address when starting their trial. Not you? Unsubscribe below and we won’t write again.',
  },
  zh: {
    greeting: '您好：',
    notices: {
      start: {
        subject: '{{Player}} 开始了 Spawn 免费试用',
        lead: '<strong>{{Player}}</strong> 刚刚开始了 Spawn 的 {{TrialDays}} 天免费试用，并把您填为家长。试用包含 {{Tokens}} 个代币（约 {{Builds}} 次生成），将于 <strong>{{EndDate}}</strong> 结束。',
        cta: '了解 Spawn',
      },
      midway: {
        subject: '{{Player}} 的 Spawn 试用已过半',
        lead: '<strong>{{Player}}</strong> 一直在用 Spawn 制作 Roblox 游戏。免费试用还剩 {{DaysLeft}} 天，将于 <strong>{{EndDate}}</strong> 结束。',
        cta: '继续使用 Spawn',
      },
      lastDay: {
        subject: '{{Player}} 的 Spawn 试用明天结束',
        lead: '<strong>{{Player}}</strong> 的 Spawn 免费试用将于 <strong>{{EndDate}}</strong> 结束。之后，在开通会员之前将无法继续生成。',
        cta: '继续使用 Spawn',
      },
      ended: {
        subject: '{{Player}} 的 Spawn 试用已结束',
        lead: '<strong>{{Player}}</strong> 的 Spawn 免费试用已结束。他们做的一切都还在 Roblox Studio 里，不会被删除。开通会员即可重新开始生成。',
        cta: '加入 Spawn',
      },
    },
    whatItIs: 'Spawn 是面向 13 岁以上 Roblox 创作者的 AI 游戏制作工具。孩子描述想要的游戏，Spawn 就在 Roblox Studio 中用真实的零件和脚本把它做出来，脚本清晰易读，适合学习。它遵守 Roblox 社区准则，并拒绝后门或隐藏代码。',
    price: '会员费为<strong>每月 {{Price}}</strong>，可随时取消。代币包 10 美元起，每次充值都由您决定，失败的生成从不收费。',
    why: '您收到这封邮件，是因为 {{Player}} 在开始试用时填写了您的邮箱。如果不是您，请点击下方退订，我们将不再联系您。',
  },
  es: {
    greeting: 'Hola:',
    notices: {
      start: {
        subject: '{{Player}} empezó una prueba gratis de Spawn',
        lead: '<strong>{{Player}}</strong> acaba de empezar una prueba gratis de {{TrialDays}} días de Spawn y te indicó como su adulto responsable. La prueba incluye {{Tokens}} tokens (unas {{Builds}} creaciones) y termina el <strong>{{EndDate}}</strong>.',
        cta: 'Ver Spawn',
      },
      midway: {
        subject: '{{Player}} va por la mitad de su prueba de Spawn',
        lead: '<strong>{{Player}}</strong> ha estado creando juegos de Roblox con Spawn. A su prueba gratis le quedan {{DaysLeft}} días y termina el <strong>{{EndDate}}</strong>.',
        cta: 'Seguir con Spawn',
      },
      lastDay: {
        subject: 'La prueba de Spawn de {{Player}} termina mañana',
        lead: 'La prueba gratis de Spawn de <strong>{{Player}}</strong> termina el <strong>{{EndDate}}</strong>. Después, el creador se cierra hasta que empiece la membresía.',
        cta: 'Seguir con Spawn',
      },
      ended: {
        subject: 'La prueba de Spawn de {{Player}} ha terminado',
        lead: 'La prueba gratis de Spawn de <strong>{{Player}}</strong> terminó. Todo lo que creó sigue en Roblox Studio; no se borra nada. Una membresía vuelve a abrir el creador.',
        cta: 'Unirse a Spawn',
      },
    },
    whatItIs: 'Spawn es un creador de juegos con IA para creadores de Roblox de 13 años o más. Describen un juego y Spawn lo construye en Roblox Studio con piezas y scripts reales que pueden leer y de los que pueden aprender. Sigue las Normas de la Comunidad de Roblox y rechaza código oculto o puertas traseras.',
    price: 'La membresía cuesta <strong>{{Price}} al mes</strong> y se puede cancelar cuando quieras. Los tokens vienen en paquetes desde 10 $, tú eliges cada recarga y las creaciones fallidas nunca se cobran.',
    why: 'Recibiste esto porque {{Player}} escribió tu dirección al empezar su prueba. ¿No eres tú? Date de baja abajo y no volveremos a escribirte.',
  },
  fr: {
    greeting: 'Bonjour,',
    notices: {
      start: {
        subject: '{{Player}} a commencé un essai gratuit de Spawn',
        lead: '<strong>{{Player}}</strong> vient de commencer un essai gratuit de Spawn de {{TrialDays}} jours et t’a indiqué comme adulte responsable. L’essai comprend {{Tokens}} tokens (environ {{Builds}} créations) et se termine le <strong>{{EndDate}}</strong>.',
        cta: 'Découvrir Spawn',
      },
      midway: {
        subject: '{{Player}} est à la moitié de son essai Spawn',
        lead: '<strong>{{Player}}</strong> crée des jeux Roblox avec Spawn. Son essai gratuit se termine dans {{DaysLeft}} jours, le <strong>{{EndDate}}</strong>.',
        cta: 'Continuer avec Spawn',
      },
      lastDay: {
        subject: 'L’essai Spawn de {{Player}} se termine demain',
        lead: 'L’essai gratuit de Spawn de <strong>{{Player}}</strong> se termine le <strong>{{EndDate}}</strong>. Ensuite, le créateur se ferme jusqu’au début de l’abonnement.',
        cta: 'Continuer avec Spawn',
      },
      ended: {
        subject: 'L’essai Spawn de {{Player}} est terminé',
        lead: 'L’essai gratuit de Spawn de <strong>{{Player}}</strong> est terminé. Tout ce qui a été créé reste dans Roblox Studio ; rien n’est supprimé. Un abonnement rouvre le créateur.',
        cta: 'Rejoindre Spawn',
      },
    },
    whatItIs: 'Spawn est un créateur de jeux par IA pour les créateurs Roblox de 13 ans et plus. Ils décrivent un jeu et Spawn le construit dans Roblox Studio avec de vraies pièces et de vrais scripts, lisibles et instructifs. Il respecte les Règles de la communauté Roblox et refuse tout code caché ou porte dérobée.',
    price: 'L’abonnement coûte <strong>{{Price}} par mois</strong>, résiliable à tout moment. Les tokens sont vendus en packs dès 10 $, tu choisis chaque recharge, et les créations ratées ne sont jamais facturées.',
    why: 'Tu reçois ce message parce que {{Player}} a saisi ton adresse en commençant son essai. Ce n’est pas toi ? Désinscris-toi ci-dessous et nous ne t’écrirons plus.',
  },
  de: {
    greeting: 'Hallo,',
    notices: {
      start: {
        subject: '{{Player}} hat eine kostenlose Spawn-Testphase gestartet',
        lead: '<strong>{{Player}}</strong> hat gerade eine {{TrialDays}}-tägige kostenlose Testphase von Spawn gestartet und dich als erwachsene Bezugsperson angegeben. Sie enthält {{Tokens}} Tokens (etwa {{Builds}} Builds) und endet am <strong>{{EndDate}}</strong>.',
        cta: 'Spawn ansehen',
      },
      midway: {
        subject: '{{Player}} ist bei der Hälfte der Spawn-Testphase',
        lead: '<strong>{{Player}}</strong> baut mit Spawn Roblox-Spiele. Die kostenlose Testphase läuft noch {{DaysLeft}} Tage und endet am <strong>{{EndDate}}</strong>.',
        cta: 'Spawn weiter nutzen',
      },
      lastDay: {
        subject: 'Die Spawn-Testphase von {{Player}} endet morgen',
        lead: 'Die kostenlose Spawn-Testphase von <strong>{{Player}}</strong> endet am <strong>{{EndDate}}</strong>. Danach ist der Baukasten geschlossen, bis die Mitgliedschaft beginnt.',
        cta: 'Spawn weiter nutzen',
      },
      ended: {
        subject: 'Die Spawn-Testphase von {{Player}} ist vorbei',
        lead: 'Die kostenlose Spawn-Testphase von <strong>{{Player}}</strong> ist beendet. Alles Gebaute bleibt in Roblox Studio; nichts wird gelöscht. Eine Mitgliedschaft öffnet den Baukasten wieder.',
        cta: 'Spawn beitreten',
      },
    },
    whatItIs: 'Spawn ist ein KI-Spielebaukasten für Roblox-Creator ab 13. Sie beschreiben ein Spiel, und Spawn baut es in Roblox Studio aus echten Teilen und Skripten, die man lesen und von denen man lernen kann. Spawn hält sich an die Roblox-Community-Standards und lehnt versteckten Code und Hintertüren ab.',
    price: 'Die Mitgliedschaft kostet <strong>{{Price}} im Monat</strong> und ist jederzeit kündbar. Tokens gibt es in Paketen ab 10 $, du entscheidest über jede Aufladung, und fehlgeschlagene Builds kosten nie etwas.',
    why: 'Du bekommst diese E-Mail, weil {{Player}} deine Adresse beim Start der Testphase angegeben hat. Nicht du? Melde dich unten ab, dann schreiben wir nicht mehr.',
  },
};

export interface SpawnParentEmailVars {
  player: string;
  endDate: string;
  daysLeft: number;
  trialDays: number;
  tokens: string;
  builds: string;
  price: string;
  parentUrl: string;
}

export async function sendSpawnParentEmail(
  env: EmailEnv,
  to: string,
  notice: SpawnParentNotice,
  vars: SpawnParentEmailVars,
  unsubscribeUrl: string,
  locale: EmailLocale = DEFAULT_EMAIL_LOCALE,
): Promise<void> {
  const copy = COPY[locale] ?? COPY[DEFAULT_EMAIL_LOCALE];
  const n = copy.notices[notice];
  // Server-controlled numbers and the formatted date go in now; `{{Player}}` waits
  // for `deliver`'s escaping render (see the module docblock).
  const numbers = {
    TrialDays: vars.trialDays, DaysLeft: vars.daysLeft, Tokens: vars.tokens, Builds: vars.builds, Price: vars.price,
  };
  const body = p(copy.greeting)
    + p(fillCopy(n.lead, numbers))
    + p(copy.whatItIs)
    + p(fillCopy(copy.price, numbers))
    + cta('{{ParentUrl}}', n.cta)
    + p(copy.why, MUTED);

  await deliver(env, {
    to,
    // The subject is a header, not HTML: `deliver` fills only the body, so the
    // player's name goes in here, unescaped (escaping would print `&amp;`).
    subject: fillCopy(n.subject, { Player: vars.player }),
    body,
    locale,
    copy: emailCopy(locale),
    vars: { Player: vars.player, EndDate: vars.endDate, ParentUrl: vars.parentUrl },
    unsubscribeUrl,
  });
}
