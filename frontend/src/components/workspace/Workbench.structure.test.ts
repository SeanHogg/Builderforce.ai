import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Workbench destination chrome', () => {
  it('owns SectionTabs in its header instead of leaving them in the route body', () => {
    const workbench = readFileSync(resolve(process.cwd(), 'src/components/workspace/Workbench.tsx'), 'utf8');
    const appShell = readFileSync(resolve(process.cwd(), 'src/components/AppShell.tsx'), 'utf8');
    const header = workbench.slice(workbench.indexOf(`className={styles.head}`), workbench.indexOf(`className={styles.body}`));
    expect(header).toContain('<SectionTabs />');
    const dock = appShell.slice(appShell.indexOf('<Workbench>'), appShell.indexOf('</Workbench>'));
    expect(dock).not.toContain('<SectionTabs');
  });
});
