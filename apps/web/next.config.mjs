import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// Monorepo root — apps/web is two levels deep
const workspaceRoot = join(projectRoot, "..", "..");

const config = {
  reactStrictMode: true,
  // Disabled for beta: cacheComponents + dynamic({ssr:false}) + Turbopack 16
  // surfaced a hydration bug where the wallet-provider stack never mounted
  // CSR-side, leaving /en blank. Re-enable once Next 16 / React 19 fixes
  // land. See docs/loop-iteration-1/SUMMARY.md (iteration-1 escape hatch).
  cacheComponents: false,
  turbopack: {
    root: workspaceRoot,
  },
  // `serverExternalPackages` was previously set to pino + transports here
  // to silence Turbopack's "Failed to load external module pino-<hash>"
  // SSR error. It turned out that adding ANY package to
  // serverExternalPackages was what TRIGGERED the contenthash mangling
  // (Turbopack appends a content hash to the bare package name and the
  // resulting `require("pino-XXX")` fails). Better fix: keep the list
  // empty AND wrap the Dynamic/WalletConnect Providers in a client-only
  // dynamic import (apps/web/app/[locale]/layout.tsx → Providers is now
  // loaded with `next/dynamic` + `ssr: false`), so the SSR chunk never
  // pulls @walletconnect at all.
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        port: "3000",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "dynamic-assets.coinbase.com",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "**.coingecko.com",
        pathname: "**",
      },
      {
        protocol: "https",
        hostname: "**.coingecko.com",
      },
    ],
  },
  async headers() {
    return [
      {
        // Hash-busted public assets that never change — let CDNs hold them
        // forever. Covers audio (BGM + SFX) and network/chain icons.
        source: "/:dir(audio|sounds|networks)/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default config;
