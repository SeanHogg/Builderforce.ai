import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createJobRoutes, createNotificationRoutes } from './jobRoutes';

it('dumps the job route table', () => {
  const dump = (r: { routes: Array<{ method: string; path: string; handler: { name: string } }> }) =>
    r.routes.map((x) => `${x.method} ${x.path} ${x.handler.name || 'anon'}`).join('\n');
  const out = `${dump(createJobRoutes() as never)}\n--notifications--\n${dump(createNotificationRoutes() as never)}\n`;
  writeFileSync(process.env.ROUTE_DUMP_OUT as string, out);
});
