import type { AccountEmailResolver } from "../transport/types.js";

/**
 * Mock implementation of AccountEmailResolver for testing and initial integration.
 * In a real application, this would interact with a user/account service.
 */
export class MockAccountEmailResolver implements AccountEmailResolver {
  private readonly accountEmails: Map<string, string>;

  constructor(initialEmails?: Map<string, string>) {
    this.accountEmails = initialEmails || new Map<string, string>();
  }

  async getPrimaryEmail(accountId: string): Promise<string | null> {
    // Simulate API call delay
    await new Promise((resolve) => setTimeout(resolve, 50));
    return this.accountEmails.get(accountId) ?? null;
  }

  // Helper for tests to set mock data
  setEmail(accountId: string, email: string): void {
    this.accountEmails.set(accountId, email);
  }
}
