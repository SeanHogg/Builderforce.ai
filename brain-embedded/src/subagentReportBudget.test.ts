import { describe, expect, it } from 'vitest';
import { SUBAGENT_REPORT_CHARS, clipChildOutput } from '@builderforce/agent-tools';
import { toolOutputCap } from '@builderforce/tool-output-policy';

/** The owner's `wait_agents` result must carry four children's reports whole. The cap lives
 *  in the policy package and the per-report clip in agent-tools; this holds them together. */
describe('wait_agents budget', () => {
  it('fits four clipped reports with their headers', () => {
    const clipped = clipChildOutput('x'.repeat(SUBAGENT_REPORT_CHARS * 2));
    const header = 200;
    expect(toolOutputCap('wait_agents')).toBeGreaterThanOrEqual(4 * (clipped.length + header));
  });
});
