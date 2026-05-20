/**
 * Ponder entry. Each domain registers its handlers in its own file under
 * ./handlers; this index just imports them so ponder picks them up.
 *
 * After a worktree adds a contract address to ponder.config.ts and an
 * ABI to ./abis, uncomment the matching import below.
 */

import "./handlers/bento";
import "./handlers/bufx";
import "./handlers/markets";
import "./handlers/perps";
import "./handlers/telarana";

export {};
