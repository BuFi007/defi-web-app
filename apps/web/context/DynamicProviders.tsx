"use client";

import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { DynamicWagmiConnector } from "@dynamic-labs/wagmi-connector";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { config } from "@/lib/wagmi";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { ReactNode, useEffect } from "react";
import { DYNAMIC_ENVIRONMENT_ID } from "@/constants/Env";
import {
  ArbitrumSepolia,
  ArcTestnet,
  Avalanche,
  AvalancheFuji,
  Ethereum,
  Sepolia,
} from "@/constants/Chains";
import {
  DynamicErrorBoundary,
  installDynamicRejectionFilter,
} from "./DynamicErrorBoundary";
import { DevWalletProvider } from "@/lib/dev-wallet";
import { SessionBridge } from "@/lib/session";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletConflictDetector } from "@/components/wallet-conflict-detector";
import { purgeDynamicSession } from "./DynamicSessionPurge";

const queryClient = new QueryClient();
// IMPORTANT: Avalanche C-Chain mainnet (43114) is allow-listed here ONLY so
// that Dynamic's networkValidationMode: "always" doesn't reject the wallet
// when a user's MetaMask is sitting on AVAX mainnet at login. The wagmi
// config (lib/wagmi.ts) still only includes [avalancheFuji, arcTestnet], so
// production trading stays on Fuji + Arc — Avalanche mainnet is presented to
// the user as a recognised network for the auth handshake only. Without it,
// switching to mainnet AVAX during login fires the misleading "Please unlock
// your wallet extension and try again." overlay because Dynamic panics on
// an unknown chain id.
// Hubs + spoke chains + auth-only mainnets. Order matters — first
// entries are the WalletConnect preferred chains, so we keep the hubs
// (where trading executes) ahead of the spokes (where users hold
// collateral). Avalanche mainnet and Ethereum mainnet sit at the end
// because they're auth-handshake-only — included so MetaMask wallets
// that default to chain 1 or chain 43114 pass Dynamic's
// networkValidationMode: "always" gate without an automatic
// wallet_switchEthereumChain prompt that the user dismisses (then
// surfaces as RPC 4100 "method not authorized" + revoked accounts).
const evmNetworks = [
  AvalancheFuji,
  ArcTestnet,
  Sepolia,
  ArbitrumSepolia,
  Avalanche,
  Ethereum,
];
// Preferred chains for the WalletConnect handshake — keep ordered with our
// primary testnets first so the wallet defaults to a chain we actually
// transact on, while still recognising AVAX mainnet at login.
const walletConnectPreferredChains = evmNetworks.map(
  (network) => `eip155:${network.chainId}` as const
);

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    installDynamicRejectionFilter();
  }, []);

  return (
    <DynamicErrorBoundary>
    <DynamicContextProvider
      settings={{
        environmentId: DYNAMIC_ENVIRONMENT_ID,
        walletConnectors: [EthereumWalletConnectors],
        // Bypass @metamask/sdk wrapping. Dynamic defaults useMetamaskSdk
        // to true, which routes MetaMask calls through MetaMaskSDK 0.33.0
        // even when the extension is installed. The SDK initializes with
        // its own session identity (dappMetadata.url-derived) that doesn't
        // match the extension's per-origin permission record — so connect
        // succeeds, but the auth-handshake signMessage immediately fires
        // RPC 4100 ("method not authorized"), MetaMask revokes
        // eth_accounts (Array(1) → Array(0)), and the user sees "Please
        // unlock your wallet extension". With useMetamaskSdk:false,
        // MetaMask is detected via EIP-6963 and uses the injected
        // provider directly. See @dynamic-labs/ethereum
        // EthereumWalletConnectors.js:40 — MetaMaskConnector is omitted
        // from the connector list when this flag is false.
        useMetamaskSdk: false,
        // "withoutSigning" defers chain validation until the user actually
        // tries to sign a tx — auth handshake accepts any chain. Was
        // "always" which triggered an auto wallet_switchEthereumChain
        // during login; a dismissed switch on a not-yet-added Arc Testnet
        // caused MetaMask to revoke eth_accounts (Array(1) → Array(0)) and
        // surface the misleading "Please unlock your wallet extension"
        // overlay. See docs/loop-iteration-1/SUMMARY.md.
        networkValidationMode: "sign-in",
        walletConnectPreferredChains,
        social: {
          strategy: "popup",
        },
        events: {
          onEmbeddedWalletCreated: (verifiedCredential, user) => {
            console.info("Dynamic embedded wallet created", {
              credentialFormat: verifiedCredential?.format,
              userId: user?.userId,
            });
          },
          onWalletAdded: ({ wallet, userWallets }) => {
            console.info("Dynamic wallet added", {
              address: wallet.address,
              chain: wallet.chain,
              walletCount: userWallets.length,
            });
          },
          onWalletConnectionFailed: (walletConnector, error) => {
            // Unwrap the Error to plain fields — `console.error(obj)` was
            // printing `[object Error]` and hiding the real message/code,
            // which made diagnosis impossible from console alone.
            const err = error as
              | (Error & { code?: number; data?: unknown })
              | undefined;
            console.error("Dynamic wallet connection failed", {
              wallet: walletConnector?.name,
              chainId: walletConnector?.connectedChain,
              message: err?.message,
              code: err?.code,
              name: err?.name,
              stack: err?.stack?.split("\n").slice(0, 4).join("\n"),
              data: err?.data,
            });
            // Do NOT call purgeDynamicSession() here — that would wipe
            // localStorage keys including the just-granted MetaMask
            // permission, pushing users into a self-inflicted
            // Array(1)->Array(0) loop.
            //
            // However, DO clear the Dynamic JWT cookie when the failure
            // looks like an auto-rejection (code 4001) caused by stale
            // auth state. The cookie purge is safe — it only affects the
            // Dynamic server-side session, not MetaMask's local
            // permission grant.
            if (err?.code === 4001 || err?.message?.includes("User rejected")) {
              try {
                document.cookie =
                  "DYNAMIC_JWT_TOKEN=; Max-Age=-99999999; path=/; SameSite=Lax";
              } catch {
                // Best-effort cookie clear.
              }
            }
          },
          onAuthFailure: (data, reason) => {
            const errorMsg =
              typeof reason === "string" ? reason : reason?.error;
            const errorStr = String(
              errorMsg instanceof Error ? errorMsg.message : errorMsg ?? "",
            );
            console.warn("Dynamic auth failure", {
              method: data?.type,
              reason: errorStr,
            });
            // Purge the Dynamic JWT cookie on auth failure. The SDK's
            // logoutWithReason only clears the cookie when client.user
            // is non-null, but during a stale-cookie 401 the user is
            // null, so the cookie lingers and poisons every subsequent
            // connect attempt. We clear it here as a safety net.
            //
            // We do NOT purge localStorage here — that would wipe the
            // just-granted MetaMask permission and cause the
            // Array(1)->Array(0) loop. Cookie-only purge is safe
            // because the cookie is Dynamic's server-side session, not
            // the local wallet permission state.
            if (
              errorStr.includes("rejected") ||
              errorStr.includes("4001") ||
              errorStr.includes("expired") ||
              errorStr.includes("unauthorized") ||
              errorStr.includes("401")
            ) {
              try {
                document.cookie =
                  "DYNAMIC_JWT_TOKEN=; Max-Age=-99999999; path=/; SameSite=Lax";
              } catch {
                // Best-effort cookie clear.
              }
            }
          },
          onLogout: () => {
            // Clean exit. Dynamic's own logout already clears its
            // session, but our extra keys (delegation_state, store, etc.)
            // can linger. Belt-and-suspenders purge.
            purgeDynamicSession();
          },
        },
        overrides: {
          evmNetworks: evmNetworks.map((network) => ({
            ...network,
            iconUrls: network.iconUrls,
          })),
        },
      }}
    >
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <DynamicWagmiConnector>
            <DevWalletProvider>
              {/* SessionBridge is the ONE place that writes to the BufiSession
                  store. Mounted here so wagmi + Dynamic hooks resolve. No
                  signing happens here — that's lib/session/use-ensure-session. */}
              <SessionBridge />
              {/* Detects the "window.ethereum has only a getter" MM
                  injection failure caused by another wallet extension
                  (Phantom, Brave Wallet, Rabby, etc.) and surfaces the
                  workaround as a toast. The hijack can't be fixed from
                  page-land — extensions fight each other before our JS
                  runs — but the user shouldn't be left thinking the app
                  is broken. */}
              <WalletConflictDetector />
              {/* TooltipProvider is required by every Radix Tooltip in the
                  tree. delayDuration: 200ms matches desk-v1's feel. */}
              <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
            </DevWalletProvider>
          </DynamicWagmiConnector>
        </QueryClientProvider>
      </WagmiProvider>
    </DynamicContextProvider>
    </DynamicErrorBoundary>
  );
}
