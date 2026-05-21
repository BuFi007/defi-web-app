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

/**
 * Conditionally wrap with `withSentryConfig` so the build stays a clean
 * no-op when Sentry envs are unset. We dynamic-import `@sentry/nextjs`;
 * if it isn't installed (workspaces without observability provisioned),
 * we just return the bare config.
 *
 * Source-map upload only fires when `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` +
 * `SENTRY_PROJECT` are all present — Sentry's plugin no-ops otherwise.
 */
async function buildConfig() {
  const dsn = process.env.SENTRY_DSN_WEB;
  if (!dsn) return config;
  try {
    const mod = await import("@sentry/nextjs").catch(() => null);
    const withSentryConfig = mod?.withSentryConfig;
    if (typeof withSentryConfig !== "function") return config;
    return withSentryConfig(config, {
      // Auth token + org/project come from env so we never commit them.
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      // Hide source maps from the deployed bundle but still upload them
      // to Sentry for stack-trace symbolication.
      hideSourceMaps: true,
      // Keep the build log clean unless something actually breaks.
      silent: !process.env.CI,
      // Tree-shake out the SDK's debug logger in prod bundles.
      disableLogger: true,
      // We already have our own ad-blocker tunnel at /api/sentry-tunnel.
      tunnelRoute: "/api/sentry-tunnel",
      // Turbopack-friendly: don't try to inject a webpack plugin if the
      // build is running under Turbopack (default in Next 16 dev/build).
      widenClientFileUpload: true,
    });
  } catch {
    return config;
  }
}

export default await buildConfig();
