/**
 * Messages module mock.
 * These mocks must never count toward coverage; they are placed to keep tests reachable.
 */

// Simulated messages-based tracking mock (not the real module, which will be implemented by itself).
export const mockMessages = {
  createSyncEntry: (payload: any) => {
    // Shadowing real implementation location; will be replaced when implementation exists.
    // No-change mock for now.
    return payload;
  },
  getDisplayText: (payload: any) => {
    return JSON.stringify(payload);
  },
};

export default mockMessages;