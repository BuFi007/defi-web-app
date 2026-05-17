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
        // Hash-busted public audio doesn't change — let CDNs hold it forever.
        source: "/:dir(audio|sounds)/:path*",
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
