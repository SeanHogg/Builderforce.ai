'use client';

import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import type { WidgetDef } from '@/lib/widgets/types';
import { PinButton } from './PinButton';
import { useWidgetDrill } from './useWidgetDrill';

/**
 * The chrome around a registered widget: the card frame, the title, the pin
 * control in the top-right corner, and the click-to-drill affordance. The widget
 * {@link WidgetDef.Card} renders ONLY its body (a chart/stat/table) — this owns
 * the consistent frame so every widget looks the same wherever it appears (home
 * dashboard, a custom dashboard, or inside its source lens).
 *
 * It self-gates on the widget's capability (disabled + "Requires <Role>", never
 * hidden) and self-decides its drill affordance — callers pass only the def.
 */
export function WidgetCard({ def, days, showDrill = true }: { def: WidgetDef; days: number; showDrill?: boolean }) {
  const t = useTranslations('widgets');
  const drill = useWidgetDrill();
  const Card = def.Card;
  const drillable = def.drill != null && showDrill;

  const body = (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 18, height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{t(`title.${def.titleKey}`)}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {drillable && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); drill(def.drill); }}
              title={t('expand')}
              aria-label={t('expand')}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, border: '1px solid var(--border-subtle)', borderRadius: 7, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <svg viewBox="0 0 24 24" aria-hidden style={{ width: 14, height: 14, fill: 'none', stroke: 'currentColor', strokeWidth: 2 }}>
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          <PinButton widgetKey={def.id} />
        </div>
      </div>
      <div
        style={{ flex: 1, minHeight: 0, cursor: drillable ? 'pointer' : 'default' }}
        onClick={drillable ? () => drill(def.drill) : undefined}
      >
        <Card days={days} />
      </div>
    </div>
  );

  if (def.capability) {
    return <RoleGate capability={def.capability} variant="block">{body}</RoleGate>;
  }
  return body;
}
