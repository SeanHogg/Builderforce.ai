import { Logger } from "./logging.js";

const logger = new Logger("AccountUtil");

/**
 * Account representation.
 * Extensible - add other relevant account properties as needed.
 */
export interface Account {
  id: string;
  name: string;
  primaryEmail: string | null;
}

/**
 * Port: Retrieves the primary email address for an account holder (domain port).
 *
 * Single Responsibility - only account → email resolution.
 * This implements the AccountEmailResolver interface defined in
 * agent-runtime/src/transport/types.ts
 */
export class AccountUtil {
  constructor() {
    logger.info("AccountUtil initialized. (Placeholder - no actual data fetching configured)");
  }

  /**
   * Retrieves the primary email for an account using the domain port interface.
   * @param accountId - The ID of the account.
   * @returns Promise<string | null> - The account holder's email address or null if not found.
   */
  public async getPrimaryEmail(accountId: string): Promise<string | null> {
    logger.debug(`Retrieving primary email for account ${accountId}...`);
    try {
      const account = await this.getAccountById(accountId);
      return account?.primaryEmail ?? null;
    } catch (error) {
      logger.error(`Error retrieving account ${accountId}:`, error);
      return null;
    }
  }

  /**
   * Retrieves account details by account ID.
   * @param accountId - The ID of the account to retrieve.
   * @returns Promise<Account | null> - The account details or null if not found.
   */
  public async getAccountById(accountId: string): Promise<Account | null> {
    logger.debug(`Attempting to retrieve account by ID: ${accountId}`);

    // TODO: Replace this with actual data fetching logic.
    // Example: Fetch from a database or an account management API.
    // const accountData = await this.accountRepository.findById(accountId);

    // For demonstration purposes, return mock data.
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 500));

    if (accountId === "account-123") {
      return {
        id: "account-123",
        name: "Example Corp",
        primaryEmail: "account-holder@example.com",
      };
    } else if (accountId === "account-456") {
      return {
        id: "account-456",
        name: "Another Business",
        primaryEmail: "admin@anotherbiz.io",
      };
    } else if (accountId === "account-789-no-email") {
      return {
        id: "account-789-no-email",
        name: "No Email User",
        primaryEmail: null, // Account exists but has no primary email
      };
    } else if (Math.random() < 0.1) {
      // Simulate a 10% chance of account not found
      logger.warn(`Account with ID ${accountId} not found.`);
      return null;
    } else {
      // Default mock account if ID doesn't match known ones and not simulating not found
      return {
        id: accountId,
        name: `Account ${accountId.substring(0, 5)}`,
        primaryEmail: `user-${accountId.substring(0, 5)}@example.com`,
      };
    }
  }
}