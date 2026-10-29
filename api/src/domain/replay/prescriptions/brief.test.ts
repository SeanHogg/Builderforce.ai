/**
 * The brief hands the same finding to a person and an agent. On a hosted app the
 * agent only changes the app's workspace (it cannot build or publish — building is a
 * browser act); a person builds the preview from the Studio publish panel and publishes it (D13).
 */
import { describe, expect, it } from 'vitest';
import { buildPrescriptionBrief, type BriefInput } from './brief';

const BASE: BriefInput = {
  prescriptionId: 'rx-1',
  ruleId: 'rage_on_element',
  params: { clicks: 14 },
  pagePath: '/checkout',
  selector: '#pay',
  label: 'Pay',
  prescription: 'Make Pay respond.',
  change: { description: 'Disable the button while saving', target: '#pay' },
  acceptance: { metric: 'frustrated', direction: 'down', minVisits: 200 },
  siteLabel: 'Shop',
  mode: 'preview',
};

describe('buildPrescriptionBrief', () => {
  it('preview mode: change and verify the workspace, publish nothing — a person builds the preview', () => {
    const { description } = buildPrescriptionBrief(BASE);
    expect(description).toContain("Make and verify the change in this app's workspace");
    expect(description).toContain('Do NOT build or publish anything');
    expect(description).toContain('a person builds the PREVIEW release from the Studio publish panel and publishes it after review');
    expect(description).not.toContain('`prescription` = the id below');
    expect(description).toContain('Prescription id: rx-1');
  });

  it('pr and ticket modes keep their own instructions', () => {
    expect(buildPrescriptionBrief({ ...BASE, mode: 'pr' }).description).toContain('open a pull request');
    expect(buildPrescriptionBrief({ ...BASE, mode: 'ticket' }).description).toContain('ship it in the next release');
  });

  it('adds the FAQ and talk-track proposal for an objection pattern', () => {
    expect(buildPrescriptionBrief({ ...BASE, ruleId: 'objection_pattern' }).description).toContain('**Sales proposal:**');
  });
});
