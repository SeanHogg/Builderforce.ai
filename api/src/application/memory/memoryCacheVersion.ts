/** The governed-memory cache version key (`mem:ver:<tenant>`), bumped by every memory write. */
export const memoryVersionKey = (tenantId: number): string => `mem:ver:${tenantId}`;
