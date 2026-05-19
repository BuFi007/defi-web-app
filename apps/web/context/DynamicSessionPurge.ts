/**
 * KILL Dynamic SDK's localStorage session cache at app boot.
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
 * cross-source identity confusion. The Dynamic JWT (cookie-based, set
 * by app.dynamicauth.com) is NOT touched -- only the client-side UI
 * cache that drives re-hydration.
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
 * Drop every Dynamic UI-state localStorage key. Exported so the Dynamic
 * event handlers in DynamicProviders.tsx can re-run it mid-session when
 * Dynamic emits onWalletConnectionFailed / onAuthFailure / onLogout —
 * that way the user can never get stuck in the "wallets are mismatched"
 * overlay loop. The Dynamic JWT cookie is NOT touched (still
 * HttpOnly + scoped to dynamicauth.com).
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
}

// Module-level execution: run once the moment this module is imported.
// ClientProviders imports this BEFORE the dynamic() of DynamicProviders,
// so Dynamic boots into clean storage on every page load.
purgeDynamicSession();
