import type { CSSProperties } from 'react';
import type { DeliveryStatus } from '@/lib/builderforceApi';
import type { StatusToneMap } from '@/lib/statusTone';

/**
 * Tokens shared by the delivery lens and the panels split out of it
 * (DeliverableUpdatesFeed, DeliveryLifecycleExplorer). One copy, so the panels
 * keep reading as one lens.
 */

export const STATUS_TONE: StatusToneMap<DeliveryStatus> = {
  on_track: 'success', at_risk: 'warning', late: 'danger', done: 'info', no_signal: 'neutral',
};

export const inputStyle: CSSProperties = {
  padding: '7px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 'var(--font-size-small)',
};

export const PROJECTION_COLOR = 'var(--purple-bright)';
