/**
 * Presentation adapter for Create sessions. Persistence and orchestration live
 * in the application layer so new routes do not reach into database internals.
 */
export { createCreationSessionRoutes } from '../../application/creation/creationSessionRouteService';

