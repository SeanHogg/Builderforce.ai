import type { ComponentType } from 'react';
import { InsightsApp } from '@/components/insights/InsightsApp';
import type { CapabilityAppId } from '@/lib/marketplace/capabilityApps';

/**
 * The component each capability app opens as at `/apps/<id>` — the half of
 * `CAPABILITY_APPS` that is code. Kept apart from the data so the workspace rail,
 * which lists installed apps on every page, never bundles the apps themselves.
 */
export const CAPABILITY_APP_COMPONENTS: Readonly<Record<CapabilityAppId, ComponentType>> = {
  insights: InsightsApp,
};
