'use client';

/**
 * What a domain explainer shows BEYOND its copy — a live thing, registered by
 * `copyId`.
 *
 * Nine explainers render through one component. Two of them have something a
 * visitor can USE before reading: the CFO's page has the runway calculator
 * (BurnRateOS's free `/tools/runway`), and the CEO's page has the startup
 * directory's newest cards and its two doors (BurnRateOS's "Discover startups"
 * band). A registry rather than two `if (copyId === …)` branches inside the page,
 * so the third live section is a row here.
 */

import type { ComponentType } from 'react';
import { RunwayCalculatorSection } from './RunwayCalculatorSection';
import { StartupDirectoryTeaser } from '@/components/startups/StartupDirectoryTeaser';

export interface DomainExtra {
  /** The anchor id of the section, and the index rail's entry. */
  id: string;
  /** i18n key under `burnrateMarketing.extras.<key>.heading` / `.sub`. */
  copyKey: string;
  Component: ComponentType;
}

export const DOMAIN_EXTRAS: Readonly<Record<string, DomainExtra>> = {
  businessIntelligence: { id: 'ref-runway-calculator', copyKey: 'calculator', Component: RunwayCalculatorSection },
  investorIntelligence: { id: 'ref-startup-directory', copyKey: 'directory', Component: StartupDirectoryTeaser },
};
