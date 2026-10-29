// Temporary: inject the defect, prove the guard catches it, restore.
const fs = require('node:fs');
const p = 'src/lib/team/useTeamRoster.ts';
const orig = fs.readFileSync(p, 'utf8');
fs.writeFileSync('inject-probe.bak', orig);
let s = orig
  .replace(
    "import { useViewerSession } from '@/lib/viewerSession';",
    "import { useAuth, useViewerSession } from '@/lib/AuthContext';",
  )
  .replace('const { hasTenant } = useViewerSession();', 'const { hasTenant } = useAuth();');
fs.writeFileSync(p, s);
console.log('injected useAuth() =', s.includes('useAuth();'), '| viewer import left =', s.includes('useViewerSession'));