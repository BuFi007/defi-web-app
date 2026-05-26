/**
 * KILL Dynamic SDK's localStorage + cookie session cache at app boot.
 *
 * The "Your wallets are mismatched. Switch to continue." overlay fires
 * when Dynamic restores its `primaryWallet` pointer from localStorage
 * and the address it expects doesn't match what MetaMask reports right
 * now -- even when both addresses LOOK identical, MM's site-permission
 * state or wallet-source identity (embedded vs extension) can differ
 * after a tab is closed and reopened. That overlay traps the user with
 * a "manually switch" button that does nothing because they're ALREADY
 * on the wallet it shows.
 *
 * Wiping Dynamic's session-state keys before its providers boot makes
 * every page load a fresh connect. Trade: user clicks "Connect Wallet"
 * once per session. Gain: no spurious mismatch, no stuck states, no
 * cross-source identity confusion.
 *
 * COOKIE PURGE (added to fix MetaMask auto-reject):
 * The Dynamic SDK stores its JWT in a document.cookie named
 * `DYNAMIC_JWT_TOKEN` (SameSite=Lax, path=/). When the environment ID
 * changed from the Sandbox env to the Live env, the stale cookie
 * persisted because the SDK's logoutWithReason only clears it when
 * client.user is non-null — during init with a stale cookie client.user
 * IS null, so the cookie survived. On every page load the SDK sends
 * POST /sdk/{envId}/refresh with credentials:"include", gets a 401
 * ("Session expired during initialization"), and the corrupted internal
 * auth state causes signAlreadyConnectedUser to fire proveOwnership
 * which MetaMask auto-rejects with RPC 4001.
 *
 * Clearing the cookie here, before the SDK boots, prevents the stale
 * /refresh call entirely and lets MetaMask connect cleanly.
 *
 * Module-level execution by design: this code runs the moment the
 * module is imported, BEFORE React lifecycles get a chance to read the
 * values. DynamicProviders is dynamically imported in ClientProviders,
 * so as long as THIS module is imported first (the import line in
 * ClientProviders does that), Dynamic boots into a clean storage.
 *
 * Keys kept (analytics + non-state cosmetics):
 *   - dynamic_device_fingerprint  (UUID for log correlation, no auth)
 *   - dynamic_phone_input_default_country
 *   - dynamic_captcha_token
 *
 * Keys cleared:
 */
const KEYS_TO_PURGE = [
  "dynamic_last_used_wallet",
  "dynamic_wagmi_session_settings",
  "dynamic_context_session_settings",
  "dynamic_embedded_wallet_session_settings",
  "dynamic_embedded_secure_banner",
  "dynamic_connected_wallet_ns",
  "dynamic_store",
  "dynamic_delegation_state",
  "dynamic_secure_enclave_session_keys",
  "dynamic_newtoweb3_wallet_extension_installed",
  "dynamic_wallet_picker_search",
  "dynamic_exchange_picker_search",
] as const;

/**
 * The cookie name Dynamic SDK uses for its JWT token. It is set via
 * document.cookie (NOT HttpOnly) with `SameSite=Lax; path=/`. The SDK
 * source: `@dynamic-labs-sdk/client/dist/getVerifiedCredentialForWalletAccount-*.esm.js`
 * defines `const DYNAMIC_AUTH_COOKIE_NAME = "DYNAMIC_JWT_TOKEN"`.
 */
const DYNAMIC_AUTH_COOKIE_NAME = "DYNAMIC_JWT_TOKEN";

/**
 * Expire the Dynamic JWT cookie so the SDK doesn't attempt a /refresh
 * call with a stale token on initialization. We expire it for both the
 * current path and root path to cover all bases.
 */
function purgeDynamicCookie(): void {
  if (typeof document === "undefined") return;
  try {
    // Expire for path=/ (how the SDK sets it)
    document.cookie = `${DYNAMIC_AUTH_COOKIE_NAME}=; Max-Age=-99999999; path=/; SameSite=Lax`;
    // Also expire for the current path in case of any mismatch
    document.cookie = `${DYNAMIC_AUTH_COOKIE_NAME}=; Max-Age=-99999999; SameSite=Lax`;
  } catch {
    // Silently ignore — cookie access can fail in some restrictive
    // environments but the purge is best-effort.
  }
}

/**
 * Drop every Dynamic UI-state localStorage key AND the JWT cookie.
 * Exported so the Dynamic event handlers in DynamicProviders.tsx can
 * re-run it mid-session when Dynamic emits onAuthFailure / onLogout —
 * that way the user can never get stuck in stale-session loops.
 */
export function purgeDynamicSession(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of KEYS_TO_PURGE) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Safari private mode + a few other edge cases throw on localStorage
    // access. Silent fail — losing the purge is harmless, the user just
    // gets the legacy behavior we tried to suppress.
  }
  purgeDynamicCookie();
}

/**
 * Clear ONLY the Dynamic IndexedDB databases that cache session state.
 * The SDK persists session keys and storage sync data in IndexedDB
 * (database names like `dynamic-sdk-{envId}` and `keychain-{envId}`).
 * When the env ID changes, the old databases linger and can confuse the
 * SDK's initialization. We wipe any `dynamic-` prefixed databases.
 */
function purgeDynamicIndexedDB(): void {
  if (typeof window === "undefined" || !window.indexedDB?.databases) return;
  window.indexedDB
    .databases()
    .then((dbs) => {
      for (const db of dbs) {
        if (db.name && db.name.startsWith("dynamic-")) {
          window.indexedDB.deleteDatabase(db.name);
        }
      }
    })
    .catch(() => {
      // indexedDB.databases() is not supported in all browsers (e.g.
      // Firefox). Best-effort purge only.
    });
}

// Module-level execution: run once the moment this module is imported.
// ClientProviders imports this BEFORE the dynamic() of DynamicProviders,
// so Dynamic boots into clean storage on every page load.
purgeDynamicSession();
purgeDynamicIndexedDB();
