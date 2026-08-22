/**
 * /hires is retired — employer-side management of hired freelancers now lives as
 * the Talent tab of Workforce. The route stays so old links and bookmarks land
 * on the relocated surface; it forwards on the server, so nothing is downloaded
 * to be thrown away.
 */
import { retiredRoute } from '@/lib/routing/retiredRoute';

export default retiredRoute('/workforce?tab=talent');
