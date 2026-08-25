'use client';

// Same reason as AboutAppSection: `/` must stay statically prerenderable, so a
// marketing band on it reads copy through `useTranslations()` on the client
// rather than `getTranslations()`, which would touch the locale cookie and turn
// the highest-traffic route into a per-request function.
import { useTranslations } from 'next-intl';
import { Icon, type IconName } from '@/components/ui/Icon';
import { seatHueVar, seatTint, type SeatOrPlatform } from '@/lib/seats';
import {
  CardText,
  CardTitle,
  HomeCard,
  HomeGrid,
  HomeSection,
  HomeSectionHeader,
} from './HomePatterns';

type GraphNode = { title: string; body: string };

/**
 * THE COMPANY GRAPH — the band that says what holds the rest together.
 *
 * The homepage argues in order: the board (hero) → what the application is
 * (About) → the tool-sprawl problem and the three-step answer (Tension) → what
 * it is (Meet) → see it run (Demo). This band sits between "what it is" and
 * "see it run" and answers the question those two leave open for a founder:
 * WHAT connects a canvas full of objects to a round you can actually close.
 *
 * The answer is one company record. `companies` already carries stage, sector,
 * ARR and valuation; `projects.company_id` hangs the work off it; a data room
 * is bound to the company rather than floating beside it; and a diligence
 * document that is `required` and still `requested` is a GAP whose category
 * names the seat that closes it. That last one is the retention argument and it
 * is why the fourth card is about what is MISSING from the room rather than
 * what is in it.
 *
 * ── WHY EACH CARD CARRIES A SEAT ICON ────────────────────────────────────────
 * The four nodes are not decoration: each is a real destination in the rail, so
 * each is drawn with that destination's own icon in its owning seat's hue,
 * through the same `Icon` component the rail uses. A visitor who signs up meets
 * the same four glyphs in the same four colours. Marketing that invents its own
 * pictograms teaches a vocabulary the product then contradicts.
 *
 * Copy is `home.founderGraph`; the icon/seat pairing is non-translatable
 * geometry paired to it BY INDEX, the convention `LandingCanvasHero` already
 * uses for its board objects. Keep both the same length and order.
 */
const NODE_MARKS: { icon: IconName; seat: SeatOrPlatform }[] = [
  { icon: 'workspace', seat: 'CEO' },
  { icon: 'project', seat: 'Manager' },
  { icon: 'people', seat: 'CEO' },
  { icon: 'lock', seat: 'Security' },
];

export function FounderGraphSection() {
  const t = useTranslations('home.founderGraph');
  const nodes = t.raw('nodes') as GraphNode[];

  return (
    <HomeSection id="company-graph">
      <HomeSectionHeader eyebrow={t('eyebrow')} title={t('title')} lead={t('lead')} />
      <HomeGrid columns={2}>
        {nodes.map((node, index) => {
          const mark = NODE_MARKS[index] ?? NODE_MARKS[0];
          return (
            <HomeCard key={node.title}>
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 'var(--control-sm)',
                  height: 'var(--control-sm)',
                  marginBottom: 'var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  color: `var(${seatHueVar(mark.seat)})`,
                  // `seatTint` rather than a literal: the fill is DERIVED from
                  // the same variable as the glyph, so the pair follows the hue
                  // through both themes and the colour is declared once.
                  background: seatTint(mark.seat),
                }}
              >
                <Icon name={mark.icon} size={18} />
              </span>
              <CardTitle>{node.title}</CardTitle>
              <CardText>{node.body}</CardText>
            </HomeCard>
          );
        })}
      </HomeGrid>
      <p style={{ marginTop: 'var(--space-5)', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
        {t('note')}
      </p>
    </HomeSection>
  );
}
