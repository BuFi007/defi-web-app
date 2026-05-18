import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// Monorepo root — apps/web is two levels deep
const workspaceRoot = join(projectRoot, "..", "..");

const config = {
  reactStrictMode: true,
  // Enables the 'use cache' directive + Partial Prerendering. Replaces the
  // legacy experimental.ppr flag in Next.js 16.
  cacheComponents: true,
  turbopack: {
    root: workspaceRoot,
  },
  // WalletConnect transitively pulls pino — needed at runtime under Node
  // but Turbopack v16's bundler chokes on it (and its thread-stream/
  // sonic-boom transports) under any layout. Mark them as runtime-external
  // and let Node's CJS resolver handle them at first import. The nested
  // pino@7 under @walletconnect/logger is patched out by the
  // scripts/dedupe-walletconnect-pino.mjs postinstall step.
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "pino-abstract-transport",
    "pino-std-serializers",
    "thread-stream",
    "sonic-boom",
  ],
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
