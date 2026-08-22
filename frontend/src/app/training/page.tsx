/**
 * /training is a convenience redirect — training happens inside the IDE embedded
 * in a project workspace, reachable from the dashboard via the 🧠 Train panel in
 * the IDE sidebar. Nothing here to render, so nothing here to ship.
 */
import { retiredRoute } from '@/lib/routing/retiredRoute';

export default retiredRoute('/dashboard');
