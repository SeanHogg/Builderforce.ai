// The application-layer seam for "is the core database refusing?", so presentation and application code never import infrastructure for it.
export { databaseUnavailableCause, isDatabaseUnavailable } from '../../infrastructure/database/neonAvailability';
