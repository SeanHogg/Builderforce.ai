/**
 * The Spawn token wallet — the shared prepaid-balance primitive in the
 * `spawn_tokens` denomination. Packs credit it (keyed on the payment), builds
 * debit it (keyed on the build), and a build is refused before the model call when
 * the wallet is below {@link MIN_BUILD_TOKENS}.
 */
import { SPAWN_TOKENS } from '../kernel/denominations';
import { prepaidBalance } from '../kernel/prepaidBalance';

export const spawnWallet = prepaidBalance(SPAWN_TOKENS, 'spawn');
